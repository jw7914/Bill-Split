import { handleAuthApi, handleUserGuildsApi } from '../server/authApi.js'
import { handleBillsApi } from '../server/billsApi.js'
import { handleDiscordApi, handleHealth } from '../server/discordApi.js'

export default async function handler(request, response) {
  const url = new URL(
    request.url || '/',
    `http://${request.headers.host || 'localhost'}`,
  )
  let path = url.pathname

  if (!path.startsWith('/api/')) {
    path = '/api' + (path.startsWith('/') ? path : '/' + path)
  }

  if (path === '/api/health') {
    await handleHealth(request, response)
    return
  }

  if (path.startsWith('/api/auth/')) {
    await handleAuthApi(request, response)
    return
  }

  if (path === '/api/discord/user-guilds') {
    await handleUserGuildsApi(request, response)
    return
  }

  if (path.startsWith('/api/discord/')) {
    await handleDiscordApi(request, response)
    return
  }

  if (path === '/api/bills' || path.startsWith('/api/bills/')) {
    await handleBillsApi(request, response)
    return
  }

  response.statusCode = 404
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ error: `API route ${path} not found.` }))
}
