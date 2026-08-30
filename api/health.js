import { handleHealth } from '../server/discordApi.js'

export default async function handler(request, response) {
  await handleHealth(request, response)
}
