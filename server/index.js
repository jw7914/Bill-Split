import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const DISCORD_API_BASE = 'https://discord.com/api/v10'

loadEnv()

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      discordConfigured: Boolean(process.env.DISCORD_BOT_TOKEN),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/discord/guilds') {
    await handleDiscordGuilds(response)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/discord/install-url') {
    await handleDiscordInstallUrl(response)
    return
  }

  const channelMatch = url.pathname.match(
    /^\/api\/discord\/guilds\/([^/]+)\/channels$/,
  )

  if (request.method === 'GET' && channelMatch) {
    await handleDiscordChannels(response, channelMatch[1])
    return
  }

  const memberMatch = url.pathname.match(
    /^\/api\/discord\/guilds\/([^/]+)\/members$/,
  )

  if (request.method === 'GET' && memberMatch) {
    await handleDiscordMembers(response, memberMatch[1])
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/discord/send') {
    await handleDiscordSend(request, response)
    return
  }

  sendJson(response, 404, { error: 'Not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Discord API server ready at http://127.0.0.1:${PORT}`)
})

async function handleDiscordSend(request, response) {
  const botToken = process.env.DISCORD_BOT_TOKEN

  if (!botToken) {
    sendJson(response, 500, {
      error: 'Discord is not configured. Add DISCORD_BOT_TOKEN to .env.',
    })
    return
  }

  let payload

  try {
    payload = JSON.parse(await readRequestBody(request))
  } catch {
    sendJson(response, 400, { error: 'Request body must be valid JSON.' })
    return
  }

  const validationError = validateBillPayload(payload)

  if (validationError) {
    sendJson(response, 400, { error: validationError })
    return
  }

  const discordResponse = await fetch(
    `${DISCORD_API_BASE}/channels/${payload.channelId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: buildDiscordMessage(payload),
        allowed_mentions: {
          parse: [],
          users: payload.participants
            .map((participant) => participant.discordUserId)
            .filter(Boolean),
        },
      }),
    },
  )

  if (!discordResponse.ok) {
    const details = await readDiscordError(discordResponse)

    sendJson(response, discordResponse.status, {
      error: 'Discord rejected the message.',
      details,
    })
    return
  }

  const message = await discordResponse.json()

  sendJson(response, 200, {
    ok: true,
    messageId: message.id,
    channelId: message.channel_id,
  })
}

async function handleDiscordGuilds(response) {
  const botToken = process.env.DISCORD_BOT_TOKEN

  if (!botToken) {
    sendJson(response, 500, {
      error: 'Discord is not configured. Add DISCORD_BOT_TOKEN to .env.',
    })
    return
  }

  const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  })

  if (!discordResponse.ok) {
    const details = await readDiscordError(discordResponse)
    sendJson(response, discordResponse.status, {
      error: 'Unable to load Discord servers.',
      details,
    })
    return
  }

  const guilds = await discordResponse.json()

  sendJson(response, 200, {
    guilds: guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
    })),
  })
}

async function handleDiscordInstallUrl(response) {
  const botToken = process.env.DISCORD_BOT_TOKEN

  if (!botToken) {
    sendJson(response, 500, {
      error: 'Discord is not configured. Add DISCORD_BOT_TOKEN to .env.',
    })
    return
  }

  const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  })

  if (!discordResponse.ok) {
    const details = await readDiscordError(discordResponse)
    sendJson(response, discordResponse.status, {
      error: 'Unable to build Discord install link.',
      details,
    })
    return
  }

  const botUser = await discordResponse.json()
  const installUrl = new URL('https://discord.com/oauth2/authorize')

  installUrl.searchParams.set('client_id', botUser.id)
  installUrl.searchParams.set('permissions', '3072')
  installUrl.searchParams.set('scope', 'bot applications.commands')

  sendJson(response, 200, { installUrl: installUrl.toString() })
}

async function handleDiscordChannels(response, guildId) {
  const botToken = process.env.DISCORD_BOT_TOKEN

  if (!botToken) {
    sendJson(response, 500, {
      error: 'Discord is not configured. Add DISCORD_BOT_TOKEN to .env.',
    })
    return
  }

  const discordResponse = await fetch(
    `${DISCORD_API_BASE}/guilds/${guildId}/channels`,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    },
  )

  if (!discordResponse.ok) {
    const details = await readDiscordError(discordResponse)
    sendJson(response, discordResponse.status, {
      error: 'Unable to load Discord channels.',
      details,
    })
    return
  }

  const channels = await discordResponse.json()

  sendJson(response, 200, {
    channels: channels
      .filter((channel) => channel.type === 0)
      .sort((a, b) => {
        const positionDifference = (a.position ?? 0) - (b.position ?? 0)

        if (positionDifference !== 0) {
          return positionDifference
        }

        return a.name.localeCompare(b.name)
      })
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentId: channel.parent_id,
      })),
  })
}

async function handleDiscordMembers(response, guildId) {
  const botToken = process.env.DISCORD_BOT_TOKEN

  if (!botToken) {
    sendJson(response, 500, {
      error: 'Discord is not configured. Add DISCORD_BOT_TOKEN to .env.',
    })
    return
  }

  const discordResponse = await fetch(
    `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000`,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    },
  )

  if (!discordResponse.ok) {
    const details = await readDiscordError(discordResponse)
    sendJson(response, discordResponse.status, {
      error:
        'Unable to load Discord users. Enable Server Members Intent for the bot in Discord Developer Portal.',
      details,
    })
    return
  }

  const members = await discordResponse.json()

  sendJson(response, 200, {
    members: members
      .filter((member) => member.user && !member.user.bot)
      .map((member) => ({
        id: member.user.id,
        name: member.nick || member.user.global_name || member.user.username,
        username: member.user.username,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })
}

function validateBillPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Missing bill payload.'
  }

  if (!payload.billName || typeof payload.billName !== 'string') {
    return 'Bill name is required.'
  }

  if (!Number.isFinite(payload.total) || payload.total <= 0) {
    return 'Bill total must be greater than zero.'
  }

  if (!payload.channelId || typeof payload.channelId !== 'string') {
    return 'Choose a Discord channel.'
  }

  if (!Array.isArray(payload.participants) || payload.participants.length < 2) {
    return 'Add at least two people to split the bill.'
  }

  for (const participant of payload.participants) {
    if (!participant.name || typeof participant.name !== 'string') {
      return 'Every participant needs a name.'
    }

    if (
      !Number.isFinite(participant.amount) ||
      participant.amount < 0 ||
      !Number.isFinite(participant.percent) ||
      participant.percent < 0
    ) {
      return 'Participant split values must be valid numbers.'
    }

    if (
      participant.discordUserId !== undefined &&
      typeof participant.discordUserId !== 'string'
    ) {
      return 'Participant Discord user IDs must be strings.'
    }
  }

  if (payload.itemized && Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (!item.name || typeof item.name !== 'string') {
        return 'Every item needs a name.'
      }

      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        return 'Every item needs a positive amount.'
      }

      if (
        !Array.isArray(item.assignedUserIds) ||
        item.assignedUserIds.length === 0
      ) {
        return 'Every item needs at least one assigned user.'
      }
    }
  }

  return ''
}

function buildDiscordMessage(payload) {
  const lines = [
    `**${payload.billName.trim()}**`,
    `Total: ${formatCurrency(payload.total)}`,
  ]

  if (payload.dueDate) {
    lines.push(`Due: ${payload.dueDate}`)
  }

  if (payload.note) {
    lines.push(`Note: ${payload.note.trim()}`)
  }

  if (payload.itemized && Array.isArray(payload.items) && payload.items.length > 0) {
    const itemTotal = payload.items.reduce((sum, item) => sum + item.amount, 0)
    const participantsById = new Map(
      payload.participants.map((participant) => [
        participant.discordUserId,
        participant,
      ]),
    )

    lines.push('', '**Items**')

    for (const item of payload.items) {
      const note = item.note ? ` - ${item.note.trim()}` : ''
      const assignees = item.assignedUserIds
        .map((userId) => participantsById.get(userId))
        .filter(Boolean)
        .map((participant) =>
          participant.discordUserId
            ? `<@${participant.discordUserId}>`
            : participant.name.trim(),
        )
        .join(', ')

      lines.push(
        `- ${item.name.trim()}: ${formatCurrency(item.amount)} assigned to ${assignees}${note}`,
      )
    }

    lines.push(`Item total: ${formatCurrency(itemTotal)}`)
  }

  lines.push('', '**Split**')

  for (const participant of payload.participants) {
    const label = participant.discordUserId
      ? `<@${participant.discordUserId}>`
      : participant.discordHandle
        ? `${participant.name.trim()} (${participant.discordHandle.trim()})`
        : participant.name.trim()

    lines.push(
      `- ${label}: ${formatCurrency(participant.amount)} (${participant.percent.toFixed(1)}%)`,
    )
  }

  return lines.join('\n')
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk

      if (body.length > 100_000) {
        request.destroy()
        rejectBody(new Error('Request body is too large.'))
      }
    })

    request.on('end', () => resolveBody(body))
    request.on('error', rejectBody)
  })
}

async function readDiscordError(discordResponse) {
  const text = await discordResponse.text()

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
  })
  response.end(JSON.stringify(body))
}

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env')

  if (!existsSync(envPath)) {
    return
  }

  const contents = readFileSync(envPath, 'utf8')

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue
    }

    const [rawKey, ...rawValue] = trimmed.split('=')
    const key = rawKey.trim()
    const value = rawValue.join('=').trim().replace(/^["']|["']$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
