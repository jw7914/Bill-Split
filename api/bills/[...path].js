import { handleBillsApi } from '../../server/billsApi.js'

export default async function handler(request, response) {
  await handleBillsApi(request, response)
}
