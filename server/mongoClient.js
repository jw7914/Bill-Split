import { MongoClient } from 'mongodb'

let client = null
let db = null
const inMemoryBills = new Map()
const inMemoryUsers = new Map()

export async function getDb() {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    return null
  }

  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
    db = client.db(process.env.MONGODB_DB_NAME || 'budget_message')
  }

  return db
}

export async function getBillsCollection() {
  const database = await getDb()
  return database ? database.collection('bills') : null
}

export async function getUsersCollection() {
  const database = await getDb()
  return database ? database.collection('users') : null
}

export async function saveBill(bill) {
  const collection = await getBillsCollection()
  const now = new Date()

  const billData = {
    ...bill,
    updatedAt: now,
    createdAt: bill.createdAt ? new Date(bill.createdAt) : now,
  }

  if (!collection) {
    inMemoryBills.set(bill.id, billData)
    return billData
  }

  await collection.updateOne(
    { _id: bill.id },
    { $set: { ...billData, _id: bill.id } },
    { upsert: true },
  )

  return billData
}

export async function getBill(id) {
  const collection = await getBillsCollection()

  if (!collection) {
    const item = inMemoryBills.get(id)
    return item ? formatBillOutput(item) : null
  }

  const doc = await collection.findOne({ _id: id })
  return doc ? formatBillOutput(doc) : null
}

export async function listBills(limit = 20) {
  const collection = await getBillsCollection()

  if (!collection) {
    const bills = Array.from(inMemoryBills.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit)

    return bills.map(formatBillOutput)
  }

  const docs = await collection
    .find({})
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray()

  return docs.map(formatBillOutput)
}

export async function deleteBill(id) {
  const collection = await getBillsCollection()

  if (!collection) {
    const deleted = inMemoryBills.delete(id)
    return { success: deleted }
  }

  const result = await collection.deleteOne({ _id: id })
  return { success: result.deletedCount > 0 }
}

export async function saveUser(user) {
  const collection = await getUsersCollection()
  const now = new Date()

  const userData = {
    _id: user.id,
    id: user.id,
    username: user.username,
    globalName: user.globalName || user.username,
    avatar: user.avatar || '',
    accessToken: user.accessToken || '',
    refreshToken: user.refreshToken || '',
    expiresAt: user.expiresAt ? new Date(user.expiresAt) : new Date(Date.now() + 604800000),
    guilds: Array.isArray(user.guilds) ? user.guilds : [],
    updatedAt: now,
  }

  if (!collection) {
    inMemoryUsers.set(user.id, userData)
    return formatUserOutput(userData)
  }

  await collection.updateOne(
    { _id: user.id },
    { $set: userData },
    { upsert: true },
  )

  return formatUserOutput(userData)
}

export async function getUser(id) {
  const collection = await getUsersCollection()

  if (!collection) {
    const user = inMemoryUsers.get(id)
    return user ? formatUserOutput(user, true) : null
  }

  const doc = await collection.findOne({ _id: id })
  return doc ? formatUserOutput(doc, true) : null
}

export async function listUsers() {
  const collection = await getUsersCollection()

  if (!collection) {
    return Array.from(inMemoryUsers.values()).map((u) => formatUserOutput(u, false))
  }

  const docs = await collection.find({}).sort({ updatedAt: -1 }).toArray()
  return docs.map((doc) => formatUserOutput(doc, false))
}

export async function deleteUser(id) {
  const collection = await getUsersCollection()

  if (!collection) {
    const deleted = inMemoryUsers.delete(id)
    return { success: deleted }
  }

  const result = await collection.deleteOne({ _id: id })
  return { success: result.deletedCount > 0 }
}

function formatBillOutput(doc) {
  return {
    id: doc._id || doc.id,
    billName: doc.billName || '',
    total: doc.total || 0,
    dueDate: doc.dueDate || '',
    note: doc.note || '',
    sendItemized: Boolean(doc.sendItemized),
    items: doc.items || [],
    participants: doc.participants || [],
    selectedGuildId: doc.selectedGuildId || '',
    selectedChannelId: doc.selectedChannelId || '',
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString(),
  }
}

function formatUserOutput(doc, includeTokens = false) {
  const output = {
    id: doc._id || doc.id,
    username: doc.username || '',
    globalName: doc.globalName || doc.username || '',
    avatar: doc.avatar || '',
    guilds: doc.guilds || [],
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString(),
  }

  if (includeTokens) {
    output.accessToken = doc.accessToken || ''
    output.refreshToken = doc.refreshToken || ''
    output.expiresAt = doc.expiresAt ? new Date(doc.expiresAt).toISOString() : ''
  }

  return output
}
