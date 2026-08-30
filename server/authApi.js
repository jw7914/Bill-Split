import { getUser, listUsers, saveUser } from './mongoClient.js'

const DISCORD_API_BASE = 'https://discord.com/api/v10'

export async function handleAuthApi(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  let path = url.pathname

  if (!path.startsWith('/api/auth/')) {
    path = '/api/auth/' + path.replace(/^\/+(api\/auth\/)?/, '')
  }

  if (request.method === 'GET' && (path === '/api/auth/discord/login' || path.endsWith('/discord/login'))) {
    await handleDiscordUserLogin(request, response, url)
    return
  }

  if (request.method === 'GET' && (path === '/api/auth/discord/callback' || path.endsWith('/discord/callback'))) {
    await handleDiscordUserCallback(request, response, url)
    return
  }

  if (request.method === 'GET' && (path === '/api/auth/me' || path.endsWith('/me'))) {
    await handleGetAuthMe(request, response, url)
    return
  }

  if (request.method === 'POST' && (path === '/api/auth/logout' || path.endsWith('/logout'))) {
    await handleLogoutUser(request, response, url)
    return
  }

  sendJson(response, 404, { error: `Auth endpoint ${path} not found` })
}

export async function handleUserGuildsApi(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host}`)
  const userId = url.searchParams.get('userId') || request.headers['x-user-id']

  if (!userId) {
    sendJson(response, 400, {
      error: 'Missing userId parameter. Please sign in with Discord.',
    })
    return
  }

  const user = await getUser(userId)

  if (!user) {
    sendJson(response, 404, {
      error: 'User session not found. Please sign in with Discord.',
    })
    return
  }

  let userGuilds = user.guilds || []

  // If user has access token, fetch fresh guilds from Discord API
  if (user.accessToken) {
    try {
      const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
      })

      if (discordResponse.ok) {
        const fetchedGuilds = await discordResponse.json()

        userGuilds = fetchedGuilds.map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon,
          owner: g.owner,
          permissions: g.permissions,
        }))

        // Update user guilds in DB
        void saveUser({
          ...user,
          guilds: userGuilds,
        })
      }
    } catch {
      // Fallback to cached guilds
    }
  }

  // Fetch Bot guilds to filter only servers where the bot is added
  const botToken = process.env.DISCORD_BOT_TOKEN
  let botGuildIds = new Set()

  if (botToken) {
    try {
      const botResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: { Authorization: `Bot ${botToken}` },
      })

      if (botResponse.ok) {
        const botGuilds = await botResponse.json()
        botGuildIds = new Set(botGuilds.map((bg) => bg.id))
      }
    } catch {
      // Ignore bot lookup error
    }
  }

  // STRICT FILTER: Only return user servers where the bot has been added
  const resultGuilds = userGuilds
    .filter((guild) => botGuildIds.has(guild.id))
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      hasBot: true,
    }))

  sendJson(response, 200, {
    ok: true,
    guilds: resultGuilds,
  })
}

async function handleLogoutUser(request, response, url) {
  try {
    const body = await readJsonBody(request).catch(() => ({}))
    const userId = url.searchParams.get('userId') || body.userId || request.headers['x-user-id']

    if (!userId) {
      sendJson(response, 400, { error: 'Missing userId for logout.' })
      return
    }

    const { deleteUser } = await import('./mongoClient.js')
    await deleteUser(userId)

    sendJson(response, 200, { ok: true, message: 'Logged out successfully.' })
  } catch (error) {
    sendJson(response, 500, { error: 'Failed to logout user.', details: String(error) })
  }
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === 'object') {
    return request.body
  }

  if (typeof request.body === 'string') {
    return JSON.parse(request.body)
  }

  return JSON.parse(await readRequestBody(request))
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk

      if (body.length > 100_000) {
        request.destroy()
        rejectBody(new Error('Request body too large.'))
      }
    })

    request.on('end', () => resolveBody(body))
    request.on('error', rejectBody)
  })
}

async function handleDiscordUserLogin(request, response, url) {
  const clientId = getClientId()
  const redirectUri = getRedirectUri(url)

  const authUrl = new URL('https://discord.com/oauth2/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'identify guilds')

  if (url.searchParams.get('format') === 'json') {
    sendJson(response, 200, { loginUrl: authUrl.toString() })
    return
  }

  response.statusCode = 302
  response.setHeader('Location', authUrl.toString())
  response.end()
}

async function handleDiscordUserCallback(request, response, url) {
  const code = url.searchParams.get('code')

  if (!code) {
    sendJson(response, 400, { error: 'Missing code parameter in OAuth callback.' })
    return
  }

  const clientId = getClientId()
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  const redirectUri = getRedirectUri(url)

  if (!clientSecret) {
    sendJson(response, 500, {
      error:
        'DISCORD_CLIENT_SECRET is missing in .env. Please add DISCORD_CLIENT_SECRET from Discord Developer Portal.',
    })
    return
  }

  try {
    const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text()
      sendJson(response, tokenResponse.status, {
        error: 'Failed to exchange Discord OAuth token.',
        details: tokenError,
      })
      return
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const expiresIn = tokenData.expires_in || 604800

    // Fetch User Profile
    const profileResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!profileResponse.ok) {
      sendJson(response, profileResponse.status, {
        error: 'Failed to fetch Discord user profile.',
      })
      return
    }

    const profile = await profileResponse.json()

    // Fetch User Guilds
    let guilds = []
    try {
      const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (guildsResponse.ok) {
        guilds = await guildsResponse.json()
      }
    } catch {
      // ignore
    }

    const userRecord = {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name || profile.username,
      avatar: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : '',
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      guilds: guilds.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        owner: g.owner,
        permissions: g.permissions,
      })),
    }

    const savedUser = await saveUser(userRecord)

    // Redirect to frontend app with activeUserId query parameter
    let clientOrigin = process.env.CLIENT_ORIGIN
    if (!clientOrigin) {
      const host =
        request.headers['x-forwarded-host'] || request.headers.host || '127.0.0.1:8787'
      const protocol =
        request.headers['x-forwarded-proto'] ||
        (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https')
      clientOrigin = `${protocol}://${host}`
    }

    const frontendRedirect = new URL('/', clientOrigin)
    frontendRedirect.searchParams.set('activeUserId', savedUser.id)

    response.statusCode = 302
    response.setHeader('Location', frontendRedirect.toString())
    response.end()
  } catch (error) {
    sendJson(response, 500, {
      error: 'OAuth callback exchange failed.',
      details: String(error),
    })
  }
}

async function handleGetAuthMe(request, response, url) {
  try {
    const users = await listUsers()
    const activeUserId =
      url.searchParams.get('activeUserId') || request.headers['x-user-id']

    let activeUser = null
    if (activeUserId) {
      activeUser = (await getUser(activeUserId)) || users[0] || null
    } else {
      activeUser = users[0] || null
    }

    sendJson(response, 200, {
      ok: true,
      activeUser,
      users,
    })
  } catch (error) {
    sendJson(response, 500, {
      error: 'Failed to fetch active user session.',
      details: String(error),
    })
  }
}



function getClientId() {
  if (process.env.DISCORD_CLIENT_ID) {
    return process.env.DISCORD_CLIENT_ID
  }

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken) {
    try {
      const parts = botToken.split('.')
      if (parts[0]) {
        return Buffer.from(parts[0], 'base64').toString('utf-8')
      }
    } catch {
      // ignore
    }
  }

  return ''
}

function getRedirectUri(url) {
  let uri = process.env.DISCORD_REDIRECT_URI

  if (!uri) {
    uri = `${url.protocol}//${url.host}/api/auth/discord/callback`
  }

  return uri.replace(/([^:]\/)\/+/g, '$1')
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')

  if (statusCode === 204) {
    response.end()
    return
  }

  response.end(JSON.stringify(body))
}
