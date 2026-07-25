# StarrBot

Multi-bot Discord management framework. Deploy and manage multiple Discord bots from a single web dashboard.

## Features

- **Multi-bot** — run multiple bots from one container
- **Web dashboard** — start/stop bots, configure functions, monitor status
- **Functions** — modular: Updates (RSS), Tickets, extensible
- **Real-time** — SSE-powered live status and error logs
- **Onboarding** — step-by-step wizard for new bot setup

## Prerequisites

- Ubuntu server with Docker (`sudo apt install docker.io docker-compose -y`)
- Discord account with a bot application

## Deploy

```bash
git clone <your-repo-url>
cd starrbot
sudo docker compose up -d
```

Open `http://YOUR_SERVER_IP:2013` — the onboarding wizard will guide you through creating your first bot.

## Dashboard

- **Left sidebar** — bot list with real-time status dots (green=running, grey=stopped, red=error)
- **Overview** — status, posts sent, errors, last check, active functions
- **Functions** — enable/disable Updates and Tickets, configure per-bot
- **Settings** — change name, token, delete bot
- **User management** — multi-user auth with admin/viewer roles
- **Settings** — global command prefix, theme picker

## Discord Commands

Commands work alongside the dashboard:

| Command | Who | What |
|---------|-----|------|
| `!ping` | Everyone | Check bot is alive |
| `!feeds` | Everyone | List monitored feeds |
| `!stats` | Everyone | View bot statistics |
| `!addfeed <url>` | Admin | Add a feed |
| `!removefeed <#>` | Admin | Remove a feed |
| `!ticket <msg>` | Everyone | Create a support ticket |
| `!close` | Admin | Close a ticket |
| `!priority <low\|medium\|high>` | Admin | Set ticket priority |
| `!assign @user` | Admin | Assign ticket to admin |

## Architecture

```
starrbot/
├── index.js              # HTTP server, API, SSE
├── bot-manager.js        # Manages all bot instances
├── managed-bot.js        # Single bot lifecycle
├── functions/
│   ├── updates.js        # RSS monitoring
│   └── tickets.js        # Ticket system
├── public/index.html     # Dashboard SPA
├── data/starrbot.json    # All config
└── docker-compose.yml
```

## Adding a New Function

Create `functions/myfunction.js`:

```js
module.exports = {
  name: 'myfunction',
  description: 'What it does',
  icon: '🔧',
  defaults: { /* default config */ },
  configFields: [
    { key: 'setting', label: 'Setting', type: 'text', hint: 'Description' },
  ],
  registerCommands(client, config, managedBot) { /* Discord commands */ },
  start(managedBot, config) { /* start logic */ },
  stop(managedBot) { /* cleanup */ },
  getStats(managedBot) { return {}; },
};
```

Add one line to `functions/index.js`:

```js
const myfunction = require('./myfunction');
const registry = { updates, tickets, myfunction };
```

Dashboard auto-discovers it. No other changes needed.

## Troubleshooting

**Dashboard not loading:**
- Check container is running: `sudo docker ps`
- Port 2013 must be open on firewall

**Bot won't start:**
- Dashboard → click bot → check error log for details
- Token must be valid (wizard validates before saving)

**Feeds not posting:**
- Dashboard → Functions → Updates → verify channel ID and sources
- RSSHub must be reachable from the bot container

**Force restart:**
```bash
sudo docker compose pull && sudo docker compose up -d
```
