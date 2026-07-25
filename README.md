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

## Step 2: Clone and Deploy

SSH into your server and run:

```bash
cd /opt
sudo git clone https://github.com/YOUR_GITHUB_USER/YOUR_REPO.git
cd YOUR_REPO

# Login to GitHub Container Registry
echo "paste_your_github_pat_here" | sudo docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

# Start everything
sudo docker compose up -d
```

That's it. No config files to edit.

## Step 3: Open the Dashboard

Open `http://YOUR_SERVER_IP:3000` in your browser.

The first time you visit, you'll see the **Setup wizard**. Fill in:

1. **Discord Token** — from Step 1 above
2. **Discord Client ID** — from Step 1 above
3. **Feed Channel** — right-click a channel → Copy Channel ID
4. **Admin Channel** — right-click an admin channel → Copy Channel ID
5. **Admin Role** — right-click a role → Copy Role ID (or leave empty)
6. **Instagram Username** — the account to monitor
7. **Instagram Password** — 2FA must be OFF, use a burner account
8. **YouTube API Key** — instructions shown in the wizard
9. **RSSHub URL** — leave empty for default
10. **Dashboard Password** — protects the web UI (leave empty for no password)

Click **Save & Connect**. The bot connects to Discord and starts working.

After initial setup, use the **Config** tab to change any setting. **Feeds** tab to add/remove feeds. **Stats** tab to see activity.

## Expose RSSHub to the Internet

RSSHub runs inside Docker and needs to be accessible from the internet so your bot can fetch social media feeds.

### Nginx Proxy Manager

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

### Cloudflare DNS

1. Log in to Cloudflare → select your domain
2. Go to **DNS** → **Records** → **Add Record**
3. Fill in:
   - **Type:** `CNAME`
   - **Name:** `rsshub`
   - **Target:** `yourdomain.com`
   - **Proxy Status:** Proxied (orange cloud) ✅
4. Click **Save**

### Test It

Open your browser and go to: `https://rsshub.yourdomain.com`

You should see the RSSHub welcome page. If you do, it's working.

Then in the dashboard, set **RSSHUB_BASE_URL** to `https://rsshub.yourdomain.com` under Config.

## Auto-Updates

Watchtower is included in the stack. It polls GHCR every 5 minutes and auto-restarts the bot when a new image is pushed. Push code → GitHub Actions builds → Watchtower deploys.

## All Commands

Discord commands still work but the dashboard is easier for config and feed management.

| Command | Who Can Use It | What It Does |
|---------|---------------|--------------|
| `!help` | Everyone | Shows all commands |
| `!ping` | Everyone | Checks if bot is alive |
| `!feeds` | Everyone | Lists all monitored feeds |
| `!stats` | Everyone | Shows bot statistics |
| `!ticket <message>` | Everyone | Creates a support ticket |
| `!ticketinfo` | Anyone in ticket | Shows ticket details |
| `!close` | Admins in ticket | Closes a ticket |
| `!priority <low\|medium\|high>` | Admins in ticket | Sets ticket priority |
| `!assign @user` | Admins in ticket | Assigns ticket to admin |
| `!addfeed <url>` | Admins only | Adds a new feed |
| `!removefeed <#>` | Admins only | Removes feed by number |
| `!config show` | Admins only | Shows current config |
| `!config set <KEY> <value>` | Admins only | Sets a config value |

## Troubleshooting

**Dashboard not loading:**
- Check the bot container is running in Dockhand
- Make sure port 3000 is open on your server firewall
- Try `http://YOUR_SERVER_IP:3000` (not HTTPS)

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
