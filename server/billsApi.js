import { randomUUID } from 'node:crypto'
import {
  deleteBill,
  getBill,
  listBills,
  saveBill,
} from './mongoClient.js'

export async function handleBillsApi(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host}`)
  const path = url.pathname

  if (request.method === 'GET' && path === '/api/bills') {
    await handleListBills(response)
    return
  }

  if (request.method === 'POST' && path === '/api/bills') {
    await handleCreateBill(request, response)
    return
  }

  const billMatch = path.match(/^\/api\/bills\/([^/]+)$/)

  if (billMatch) {
    const billId = billMatch[1]

    if (request.method === 'GET') {
      await handleGetBill(response, billId)
      return
    }

    if (request.method === 'PUT') {
      await handleUpdateBill(request, response, billId)
      return
    }

    if (request.method === 'DELETE') {
      await handleDeleteBill(response, billId)
      return
    }
  }

  sendJson(response, 404, { error: 'Endpoint not found' })
}

async function handleListBills(response) {
  try {
    const bills = await listBills(20)
    sendJson(response, 200, { ok: true, bills })
  } catch (error) {
    sendJson(response, 500, {
      error: 'Failed to list bills.',
      details: String(error),
    })
  }
}

async function handleCreateBill(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}))
    const id = body.id || randomUUID()

    const newBill = {
      id,
      billName: body.billName || 'New Split Bill',
      total: body.total || 0,
      dueDate: body.dueDate || '',
      note: body.note || '',
      sendItemized: Boolean(body.sendItemized),
      items: Array.isArray(body.items) ? body.items : [],
      participants: Array.isArray(body.participants) ? body.participants : [],
      selectedGuildId: body.selectedGuildId || '',
      selectedChannelId: body.selectedChannelId || '',
    }

    const saved = await saveBill(newBill)
    sendJson(response, 201, { ok: true, bill: saved })
  } catch (error) {
    sendJson(response, 500, {
      error: 'Failed to create bill.',
      details: String(error),
    })
  }
}

async function handleGetBill(response, billId) {
  try {
    const bill = await getBill(billId)

    if (!bill) {
      sendJson(response, 404, { error: 'Bill not found.' })
      return
    }

    sendJson(response, 200, { ok: true, bill })
  } catch (error) {
    sendJson(response, 500, {
      error: 'Failed to fetch bill.',
      details: String(error),
    })
  }
}

async function handleUpdateBill(request, response, billId) {
  try {
    const body = await readJsonBody(request)

    const updatedBill = {
      id: billId,
      billName: typeof body.billName === 'string' ? body.billName : '',
      total: Number.isFinite(body.total) ? body.total : 0,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : '',
      note: typeof body.note === 'string' ? body.note : '',
      sendItemized: Boolean(body.sendItemized),
      items: Array.isArray(body.items) ? body.items : [],
      participants: Array.isArray(body.participants) ? body.participants : [],
      selectedGuildId: typeof body.selectedGuildId === 'string' ? body.selectedGuildId : '',
      selectedChannelId: typeof body.selectedChannelId === 'string' ? body.selectedChannelId : '',
      createdAt: body.createdAt,
    }

    const saved = await saveBill(updatedBill)
    sendJson(response, 200, { ok: true, bill: saved })
  } catch (error) {
    sendJson(response, 500, {
      error: 'Failed to update bill.',
      details: String(error),
    })
  }
}

async function handleDeleteBill(response, billId) {
  try {
    const result = await deleteBill(billId)
    sendJson(response, 200, { ok: true, ...result })
  } catch (error) {
    sendJson(response, 500, {
      error: 'Failed to delete bill.',
      details: String(error),
    })
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

      if (body.length > 1_000_000) {
        request.destroy()
        rejectBody(new Error('Request body too large.'))
      }
    })

    request.on('end', () => resolveBody(body))
    request.on('error', rejectBody)
  })
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
