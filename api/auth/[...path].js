import { handleAuthApi } from '../../server/authApi.js'

export default async function handler(request, response) {
  await handleAuthApi(request, response)
}
