import { handleDiscordApi } from '../../server/discordApi.js'

export default async function handler(request, response) {
  await handleDiscordApi(request, response)
}
