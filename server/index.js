import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

import { handleAuthApi, handleUserGuildsApi } from './authApi.js'
import { handleBillsApi } from './billsApi.js'
import { handleDiscordApi, handleHealth } from './discordApi.js'

const PORT = Number(process.env.PORT || 8787)
const DIST_DIR = resolve(process.cwd(), 'dist')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

loadEnv()

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  // 1. API Route Handling
  if (url.pathname === '/api/health') {
    await handleHealth(request, response)
    return
  }

  if (url.pathname.startsWith('/api/auth/')) {
    await handleAuthApi(request, response)
    return
  }

  if (url.pathname === '/api/discord/user-guilds') {
    await handleUserGuildsApi(request, response)
    return
  }

  if (url.pathname.startsWith('/api/discord/')) {
    await handleDiscordApi(request, response)
    return
  }

  if (url.pathname === '/api/bills' || url.pathname.startsWith('/api/bills/')) {
    await handleBillsApi(request, response)
    return
  }

  if (url.pathname.startsWith('/api/')) {
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: `API route ${url.pathname} not found.` }))
    return
  }

  // 2. Static File Serving from dist/
  serveStatic(request, response, url.pathname)
})

function serveStatic(request, response, pathname) {
  let relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname
  if (!relativePath) {
    relativePath = 'index.html'
  }

  const filePath = join(DIST_DIR, relativePath)

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': contentType })
    createReadStream(filePath).pipe(response)
    return
  }

  // SPA Fallback to dist/index.html
  const indexPath = join(DIST_DIR, 'index.html')
  if (existsSync(indexPath)) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    createReadStream(indexPath).pipe(response)
    return
  }

  response.writeHead(404, { 'Content-Type': 'text/plain' })
  response.end(
    'Not found. Run "npm run build" to build frontend static files into dist/.',
  )
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server (API + Static Frontend) ready at http://127.0.0.1:${PORT}`)
})

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
