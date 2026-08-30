# Budget Message

A Vite, React, TypeScript, Tailwind CSS v4, shadcn, and Watermelon UI starter for splitting bills and sending the calculated split through a Discord bot.

The app supports simple split messages and itemized messages. Itemized mode sends each line item, its amount, optional item note, the item total, and the final participant split.

## Setup

Install dependencies:

```sh
npm install
```

Create a local environment file:

```sh
cp .env.example .env
```

Add these values to `.env`:

```sh
DISCORD_BOT_TOKEN=your_discord_bot_token
```

The Discord bot must be invited to any server you want to send messages to. It needs permission to view channels and send messages in the target channel.

Use **Add Server** in the app to open Discord's authorization flow for the current bot. After adding the bot to another server, return to the app and click **Refresh Discord**.

To select Discord users from the app, enable **Server Members Intent** for the bot in Discord Developer Portal:

1. Open your application in Discord Developer Portal.
2. Go to **Bot**.
3. Find **Privileged Gateway Intents**.
4. Enable **Server Members Intent**.
5. Restart `npm run dev`.

## Development

Start the React app and local Discord API server:

```sh
npm run dev
```

The app runs at `http://127.0.0.1:5173/`.

## Scripts

```sh
npm run dev       # Start Vite and the local API server
npm run dev:web   # Start only Vite
npm run dev:api   # Start only the Discord API server
npm run build     # Type-check and build the frontend
npm run lint      # Run oxlint
```

## Discord API

The app creates the bot install link from `GET /api/discord/install-url`, loads the bot's available Discord servers from `GET /api/discord/guilds`, text channels from `GET /api/discord/guilds/:guildId/channels`, and selectable users from `GET /api/discord/guilds/:guildId/members`.

The frontend posts bill splits to `POST /api/discord/send`. If itemized mode is enabled, the payload includes an `items` array with each item name, amount, and optional note. The payload also includes the selected `channelId`, and the local server forwards the message to:

```txt
https://discord.com/api/v10/channels/{channelId}/messages
```

Bot credentials stay server-side and are never exposed to the browser.
