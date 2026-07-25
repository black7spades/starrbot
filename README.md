# Mkitty Discord Bot

Discord bot that monitors social media RSS feeds and posts updates to a channel.

## What You Need Before Starting

- A computer running Ubuntu (your server)
- Git installed (`sudo apt install git -y`)
- Docker installed (`sudo apt install docker.io docker-compose -y`)
- A Discord account
- Access to your Cloudflare account
- Access to your Nginx Proxy Manager

## Step 1: Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it **Mkitty** → click **Create**
3. Click **Bot** in the left menu
4. Click **Reset Token** → copy this token (you only see it once)
5. Scroll down, enable these **Privileged Gateway Intents**:
   - ✅ Message Content Intent
6. Click **OAuth2** in the left menu
7. Under **OAuth2 URL Generator**, check these boxes:
   - ✅ bot
   - ✅ applications.commands
8. Under **Bot Permissions**, check:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Read Message History
   - ✅ Manage Threads
   - ✅ Send Messages in Threads
   - ✅ Read Message History (for threads)
9. Copy the **Generated URL** at the bottom → paste it in your browser → select your server → Authorize
10. Go back to the **General Information** page → copy the **Application ID** (this is your Client ID)

## Step 2: Clone, Login to GHCR, and Deploy

SSH into your server and run:

```bash
# Clone the repo
cd /opt
sudo git clone https://github.com/YOUR_GITHUB_USER/YOUR_REPO.git
cd YOUR_REPO

# Login to GitHub Container Registry (so Docker can pull the bot image)
# Create a classic PAT at https://github.com/settings/tokens with write:packages scope
echo "paste_your_github_pat_here" | sudo docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

# Create .env with just the two values the bot needs to start
sudo nano .env
```

Fill in only these two lines:

```
DISCORD_TOKEN=paste_your_bot_token_here
DISCORD_CLIENT_ID=paste_your_client_id_here
```

Save and exit: press `Ctrl+X` → `Y` → `Enter`

Then start the stack:

```bash
sudo docker compose up -d
```

## Step 3: Configure the Bot via Discord

Once the bot is running, go to your Discord server and type:

```
!setup
```

The bot will walk you through each config value with instructions on how to get it:

1. **Feed Channel** — the channel where social media posts appear (right-click → Copy Channel ID)
2. **Admin Channel** — the channel for support tickets (right-click → Copy Channel ID)
3. **Admin Role** — who can manage feeds (right-click → Copy Role ID, or `skip` for everyone)
4. **Instagram Username** — the username to monitor
5. **Instagram Password** — the password (2FA must be off, use a burner account)
6. **YouTube API Key** — how to get it is explained in the wizard
7. **RSSHub URL** — `skip` to use the default if RSSHub is on the same server

Type `!cancel` at any time to stop. All values are stored locally on the server.

## Step 4: Expose RSSHub to the Internet

RSSHub runs inside Docker and needs to be accessible from the internet so your bot can fetch social media feeds.

### 4a: Nginx Proxy Manager

1. Open Nginx Proxy Manager (usually at http://YOUR_SERVER_IP:81)
2. Click **Add Proxy Host**
3. Fill in:
   - **Domain Names:** `rsshub.yourdomain.com`
   - **Forward Hostname / IP:** your server's local IP
   - **Forward Port:** `1200`
   - ✅ Block Common Exploits
   - ✅ Websockets Support
4. Click **SSL** tab → select **Let's Encrypt** → check **Force SSL** → **Save**
5. Click **Save**

### 4b: Cloudflare DNS

1. Log in to Cloudflare → select your domain
2. Go to **DNS** → **Records** → **Add Record**
3. Fill in:
   - **Type:** `CNAME`
   - **Name:** `rsshub`
   - **Target:** `yourdomain.com`
   - **Proxy Status:** Proxied (orange cloud) ✅
4. Click **Save**

### 4c: Test It

Open your browser and go to: `https://rsshub.yourdomain.com`

You should see the RSSHub welcome page. If you do, it's working.

If your RSSHub URL is different from the default (`http://rsshub:1200`), update it:

```
!config set RSSHUB_BASE_URL https://rsshub.yourdomain.com
```

## Step 5: Add Your First Feed

```
!addfeed /tiktok/user/username
```

Replace `username` with the actual TikTok username. The `/` prefix auto-adds your RSSHub URL.

Other examples:

```
!addfeed /tiktok/user/username
!addfeed /instagram/user/natgeo
!addfeed /twitch/live/shroud
!addfeed https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw
```

To see your feeds:

```
!feeds
```

## Auto-Updates

Watchtower is included in the stack. It polls GHCR every 5 minutes and auto-restarts the bot when a new image is pushed. Push code → GitHub Actions builds → Watchtower deploys. Zero manual steps.

## All Commands

| Command | Who Can Use It | What It Does |
|---------|---------------|--------------|
| `!setup` | Admins only | First-time config wizard |
| `!config show` | Admins only | Shows current config |
| `!config set <KEY> <value>` | Admins only | Sets a config value |
| `!help` | Everyone | Shows all commands |
| `!ping` | Everyone | Checks if bot is alive |
| `!feeds` | Everyone | Lists all monitored feeds |
| `!ticket <message>` | Everyone | Creates a support ticket |
| `!ticketinfo` | Anyone in ticket | Shows ticket details |
| `!close` | Admins in ticket | Closes a ticket |
| `!priority <low\|medium\|high>` | Admins in ticket | Sets ticket priority |
| `!assign @user` | Admins in ticket | Assigns ticket to admin |
| `!addfeed <url>` | Admins only | Adds a new feed |
| `!removefeed <#>` | Admins only | Removes feed by number |
| `!stats` | Everyone | Shows bot statistics |

## Config Keys

These can be set with `!config set`:

| Key | What It Does |
|-----|-------------|
| `DISCORD_CHANNEL_ID` | Channel where posts appear |
| `ADMIN_CHANNEL_ID` | Channel for tickets |
| `ADMIN_ROLE_ID` | Role that can manage feeds (empty = everyone) |
| `IG_USERNAME` | Instagram username to monitor |
| `IG_PASSWORD` | Instagram password (2FA must be off) |
| `YOUTUBE_KEY` | YouTube Data API v3 key |
| `RSSHUB_BASE_URL` | RSSHub URL (default: `http://rsshub:1200`) |
| `CHECK_INTERVAL` | Minutes between checks (default: 15) |

## Troubleshooting

**Bot doesn't respond:**
- In Dockhand: find the `mkitty-bot` container → click **Logs**

**RSSHub not working:**
```bash
curl https://rsshub.yourdomain.com
```
Should return HTML. If not, check Nginx Proxy Manager and Cloudflare.

**Bot can't fetch feeds:**
```bash
sudo docker exec mkitty-bot wget -q -O- http://rsshub:1200/tiktok/user/username
```
Should return XML. If not, RSSHub can't reach the internet.

**Force restart (Watchtower handles most updates automatically):**
- In Dockhand: find the container → click **Restart**
- Or SSH: `sudo docker restart mkitty-bot`

**Stop everything:**
- In Dockhand: find the stack → click **Stop** or **Delete**
- Or SSH: `sudo docker compose -f /opt/YOUR_REPO/docker-compose.yml down`
