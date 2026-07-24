# Mkitty Discord Bot

Discord bot that monitors social media RSS feeds and posts updates to a channel.

## What You Need Before Starting

- A computer running Ubuntu (your servalan.one server)
- Git installed (`sudo apt install git -y`)
- Docker installed (`sudo apt install docker.io docker-compose -y`)
- A Discord account
- Access to your Cloudflare account for servalan.one
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

## Step 2: Get Your Channel IDs

1. Open Discord → go to **User Settings** → **Advanced** → turn on **Developer Mode**
2. **Channel for bot posts:** Right-click the channel where you want social media updates → **Copy Channel ID**
3. **Admin channel (for tickets/stats):** Right-click a channel only admins can see → **Copy Channel ID** (create one if needed)
4. **Admin role:** Server Settings → Roles → right-click the admin role → **Copy Role ID** (optional, can skip)

## Step 3: Clone, Login to GHCR, and Configure

SSH into your server and run:

```bash
# Clone the repo
cd /opt
sudo git clone https://github.com/black7spades/mkittybot.git
cd mkittybot

# Login to GitHub Container Registry (so Docker can pull the bot image)
# Create a classic PAT at https://github.com/settings/tokens with write:packages scope
echo "paste_your_github_pat_here" | sudo docker login ghcr.io -u black7spades --password-stdin

# Create and edit the .env file
sudo nano .env
```

Fill in the file with your actual values:

```
DISCORD_TOKEN=paste_your_bot_token_here
DISCORD_CLIENT_ID=paste_your_client_id_here
DISCORD_CHANNEL_ID=paste_your_channel_id_here
ADMIN_CHANNEL_ID=paste_your_admin_channel_id_here
ADMIN_ROLE_ID=paste_your_admin_role_id_here
RSSHUB_BASE_URL=https://rsshub.servalan.one
CHECK_INTERVAL=15
```

Save and exit: press `Ctrl+X` → `Y` → `Enter`

## Step 4: Deploy with Dockhand

### First Time Setup

1. Open Dockhand (usually at http://192.168.0.XX:8080)
2. Go to **Stacks** or **Compose**
3. Click **Add Stack** or **New Stack**
4. Name it: `mkitty-bot`
5. Set the **Working Directory** or **Source Path** to: `/opt/mkittybot`
6. Click **Deploy** or **Start**

Dockhand will pull the bot image from `ghcr.io/black7spades/mkittybot:latest` and start both the bot and RSSHub containers.

To verify it's running:
1. In Dockhand, find the `mkitty-bot-bot-1` container
2. Click **Logs** — you should see: `Logged in as Mkitty#XXXX`

### Pulling Updates via Dockhand

When you push new code and want the latest image:

**Step 1: Pull the latest image**
- In Dockhand, look for **Images** or **Docker Images** section
- Find `ghcr.io/black7spades/mkittybot`
- Click **Pull** or **Refresh** — this downloads the latest image from GitHub
- Or via SSH: `sudo docker pull ghcr.io/black7spades/mkittybot:latest`

**Step 2: Restart the container**
- In Dockhand, find your `mkitty-bot` stack
- Click **Stop** then **Start** (or **Restart**)
- The container now runs the latest image

## Step 5: Expose RSSHub to the Internet

RSSHub runs inside Docker and needs to be accessible from the internet so your bot can fetch social media feeds.

### 5a: Nginx Proxy Manager

1. Open Nginx Proxy Manager (usually at http://192.168.0.XX:81)
2. Click **Add Proxy Host**
3. Fill in:
   - **Domain Names:** `rsshub.servalan.one`
   - **Forward Hostname / IP:** your server's local IP (e.g. `192.168.0.XX`)
   - **Forward Port:** `1200`
   - ✅ Block Common Exploits
   - ✅ Websockets Support
4. Click **SSL** tab → select **Let's Encrypt** → check **Force SSL** → **Save**
5. Click **Save**

### 5b: Cloudflare DNS

1. Log in to Cloudflare → select **servalan.one**
2. Go to **DNS** → **Records** → **Add Record**
3. Fill in:
   - **Type:** `CNAME`
   - **Name:** `rsshub`
   - **Target:** `servalan.one`
   - **Proxy Status:** Proxied (orange cloud) ✅
4. Click **Save**

### 5c: Test It

Open your browser and go to: `https://rsshub.servalan.one`

You should see the RSSHub welcome page. If you do, it's working.

## Step 6: Add Your First Feed

Go to your Discord server and type:

```
!addfeed /tiktok/user/username
```

Replace `username` with the actual TikTok username. The `/` prefix auto-adds `https://rsshub.servalan.one`.

Other examples:

```
!addfeed /tiktok/user/username
!addfeed /instagram/user/natgeo
!addfeed /twitch/user/shroud
!addfeed https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw
```

To see your feeds:

```
!feeds
```

## All Commands

| Command | Who Can Use It | What It Does |
|---------|---------------|--------------|
| `!help` | Everyone | Shows all commands |
| `!ping` | Everyone | Checks if bot is alive |
| `!feeds` | Everyone | Lists all monitored feeds |
| `!ticket <message>` | Everyone | Creates a support ticket |
| `!closed` | Anyone in ticket | Closes a ticket |
| `!addfeed <url>` | Admins only | Adds a new feed |
| `!removefeed <#>` | Admins only | Removes feed by number |
| `!stats` | Everyone | Shows bot statistics |

## Troubleshooting

**Bot doesn't respond:**
- In Dockhand: find the bot container → click **Logs**
- Or SSH and run: `sudo docker compose -f /opt/mkittybot/docker-compose.yml logs bot | tail -20`

**RSSHub not working:**
```bash
curl https://rsshub.servalan.one
```
Should return HTML. If not, check Nginx Proxy Manager and Cloudflare.

**Bot can't fetch feeds:**
```bash
sudo docker compose -f /opt/mkittybot/docker-compose.yml exec bot wget -q -O- https://rsshub.servalan.one/tiktok/user/username
```
Should return XML. If not, RSSHub can't reach the internet.

**Restart after changes:**
- In Dockhand: find the container → click **Restart**
- Or SSH: `sudo docker compose -f /opt/mkittybot/docker-compose.yml restart`

**Stop everything:**
- In Dockhand: find the stack → click **Stop** or **Delete**
- Or SSH: `sudo docker compose -f /opt/mkittybot/docker-compose.yml down`
