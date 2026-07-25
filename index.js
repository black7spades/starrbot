const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const parser = new Parser();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const postedUrls = new Set();
// ponytail: flat stats object, not a class — one instance, no behavior
const stats = { postsSent: 0, errors: [], lastCheck: null };
// ponytail: in-memory ticket store, lost on restart — add a database when tickets matter across restarts
const tickets = new Map();
let ticketCounter = 0;

const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 15;
const FEEDS_FILE = `${__dirname}/feeds.json`;
const CONFIG_FILE = `${__dirname}/config.json`;
const ENV_FILE = `${__dirname}/.env`;

const SENSITIVE_KEYS = ['IG_PASSWORD', 'DISCORD_TOKEN', 'YOUTUBE_KEY'];
const RSSHUB_KEYS = ['IG_USERNAME', 'IG_PASSWORD', 'YOUTUBE_KEY', 'RSSHUB_BASE_URL'];

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }

function writeEnv(cfg) {
  const existing = {};
  try {
    fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0) existing[line.slice(0, eq)] = line.slice(eq + 1);
    });
  } catch {}
  const merged = { ...existing, ...cfg };
  fs.writeFileSync(ENV_FILE, Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

function restartRsshub() {
  try { execSync('docker restart mkitty-rsshub', { timeout: 30000 }); return true; } catch { return false; }
}

const cfg = loadConfig();

// ponytail: onboarding state machine — in-memory, lost on restart, user just runs !setup again
const setupState = new Map();
const SETUP_STEPS = [
  {
    key: 'DISCORD_CHANNEL_ID',
    label: 'Feed Channel',
    instruction: 'The channel where social media posts will be posted.\n\n**How to get it:** Right-click the channel in Discord → **Copy Channel ID**.\n(Enable Developer Mode first: Settings → Advanced → Developer Mode.)',
  },
  {
    key: 'ADMIN_CHANNEL_ID',
    label: 'Admin Channel',
    instruction: 'The channel where support tickets will be created.\n\n**How to get it:** Right-click the channel → **Copy Channel ID**.',
  },
  {
    key: 'ADMIN_ROLE_ID',
    label: 'Admin Role',
    instruction: 'The role that can manage feeds and config. Type `skip` to allow everyone.\n\n**How to get it:** Right-click the role in Server Settings → **Copy Role ID**.',
    optional: true,
    skipValue: '',
  },
  {
    key: 'IG_USERNAME',
    label: 'Instagram Username',
    instruction: 'The Instagram username to monitor.\n\n**Note:** This uses Instagram\'s private API. Use the exact username (no @).',
  },
  {
    key: 'IG_PASSWORD',
    label: 'Instagram Password',
    instruction: 'The Instagram password for the account above.\n\n**Note:** 2FA must be OFF on this account. The password is stored locally only.',
    sensitive: true,
  },
  {
    key: 'YOUTUBE_KEY',
    label: 'YouTube API Key',
    instruction: 'A YouTube Data API v3 key.\n\n**How to get it:**\n1. Go to [console.cloud.google.com](https://console.cloud.google.com)\n2. Create a project (or use existing)\n3. Go to **APIs & Services → Library**\n4. Search "YouTube Data API v3" → Enable it\n5. Go to **APIs & Services → Credentials**\n6. Click **Create Credentials → API Key**\n7. Copy the key',
  },
  {
    key: 'RSSHUB_BASE_URL',
    label: 'RSSHub URL',
    instruction: 'The URL of your RSSHub instance.\n\nIf RSSHub is on the same server, type `skip` to use the default (`http://rsshub:1200`).',
    optional: true,
    skipValue: 'http://rsshub:1200',
  },
];

async function sendSetupStep(userId, channel) {
  const state = setupState.get(userId);
  if (!state || state.step >= SETUP_STEPS.length) return;
  const s = SETUP_STEPS[state.step];
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Setup (${state.step + 1}/${SETUP_STEPS.length}): ${s.label}`)
    .setDescription(s.instruction + (s.optional ? '\n\nType `skip` to skip this step.' : ''));
  await channel.send({ embeds: [embed] });
}

// ponytail: load from file, fall back to .env seed on first run
function loadFeeds() {
  try {
    return JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveFeeds() {
  fs.writeFileSync(FEEDS_FILE, JSON.stringify(ALL_FEEDS, null, 2));
}

const ALL_FEEDS = loadFeeds();

// ponytail: role check as a one-liner, not a permission service
function isAdmin(member) {
  return !cfg.ADMIN_ROLE_ID || member.roles.cache.has(cfg.ADMIN_ROLE_ID);
}

function getPlatformFromUrl(url) {
  if (url.includes('tiktok')) return { name: 'TikTok', color: 0x000000, icon: '🎵' };
  if (url.includes('instagram')) return { name: 'Instagram', color: 0xE4405F, icon: '📸' };
  if (url.includes('youtube') || url.includes('youtu.be')) return { name: 'YouTube', color: 0xFF0000, icon: '▶️' };
  if (url.includes('twitch')) return { name: 'Twitch', color: 0x9146FF, icon: '🟣' };
  return { name: 'Social', color: 0x5865F2, icon: '🔗' };
}

function createEmbed(item, platform) {
  const embed = new EmbedBuilder()
    .setColor(platform.color)
    .setTitle(`${platform.icon} ${platform.name}: ${item.title?.slice(0, 256) || 'New Post'}`)
    .setURL(item.link)
    .setTimestamp(new Date(item.pubDate || Date.now()))
    .setFooter({ text: platform.name });

  if (item.contentSnippet) {
    embed.setDescription(item.contentSnippet.slice(0, 4096));
  }

  if (item.enclosure?.url) {
    embed.setImage(item.enclosure.url);
  } else if (item['media:content']?.$?.url) {
    embed.setImage(item['media:content'].$.url);
  } else if (item['media:thumbnail']?.$?.url) {
    embed.setImage(item['media:thumbnail'].$.url);
  }

  if (item.author) {
    embed.setAuthor({ name: item.author });
  }

  return embed;
}

async function checkFeed(feedUrl, channel) {
  try {
    const feed = await parser.parseURL(feedUrl);
    const platform = getPlatformFromUrl(feedUrl);

    for (const item of feed.items.slice(0, 5).reverse()) {
      if (postedUrls.has(item.link)) continue;
      if (item.pubDate && new Date(item.pubDate) < new Date(Date.now() - CHECK_INTERVAL * 60 * 1000 * 2)) continue;

      const embed = createEmbed(item, platform);
      await channel.send({ embeds: [embed] });
      postedUrls.add(item.link);
      stats.postsSent++;

      if (postedUrls.size > 1000) {
        const first = postedUrls.values().next().value;
        postedUrls.delete(first);
      }
    }
  } catch (err) {
    console.error(`Error checking ${feedUrl}:`, err.message);
    stats.errors.push({ url: feedUrl, error: err.message, at: new Date() });
    if (stats.errors.length > 50) stats.errors.shift();
  }
}

async function checkAllFeeds() {
  const channel = client.channels.cache.get(cfg.DISCORD_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error('Invalid channel ID');
    return;
  }

  stats.lastCheck = new Date();
  console.log(`Checking ${ALL_FEEDS.length} feeds...`);
  await Promise.all(ALL_FEEDS.map(feed => checkFeed(feed, channel)));
}

client.once('clientReady', (c) => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!cfg.DISCORD_CHANNEL_ID || !cfg.ADMIN_CHANNEL_ID) {
    console.log('⚠️  No config found. Run !setup in Discord to configure the bot.');
  }

  console.log(`Monitoring ${ALL_FEEDS.length} feeds every ${CHECK_INTERVAL} minutes`);
  setInterval(checkAllFeeds, CHECK_INTERVAL * 60 * 1000);
  if (cfg.DISCORD_CHANNEL_ID) checkAllFeeds();
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // ponytail: intercept setup replies before any other command
  if (setupState.has(msg.author.id)) {
    if (msg.content.toLowerCase() === '!cancel') {
      setupState.delete(msg.author.id);
      return msg.reply('Setup cancelled.');
    }
    if (!msg.content.startsWith('!')) {
      const state = setupState.get(msg.author.id);
      const s = SETUP_STEPS[state.step];
      const value = msg.content.trim();

      if (value.toLowerCase() === 'skip' && s.optional) {
        cfg[s.key] = s.skipValue;
      } else {
        cfg[s.key] = value;
        if (s.sensitive) await msg.reply(`${s.label} saved.`);
      }

      state.step++;
      if (state.step >= SETUP_STEPS.length) {
        saveConfig(cfg);
        writeEnv(cfg);
        setupState.delete(msg.author.id);
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('Setup Complete')
          .setDescription('All values saved. RSSHub restarting...');
        await msg.reply({ embeds: [embed] });
        const ok = restartRsshub();
        if (ok) await msg.channel.send('RSSHub restarted. Add feeds with `!addfeed`.');
        else await msg.channel.send('RSSHub restart failed — check server logs.');
        return;
      }
      await sendSetupStep(msg.author.id, msg.channel);
      return;
    }
  }

  if (msg.content === '!ping') {
    await msg.reply('Pong! 🏓');
  }

  if (msg.content === '!setup') {
    const member = await msg.guild.members.fetch(msg.author.id);
    if (!isAdmin(member)) return msg.reply('Admin only.');
    if (setupState.has(msg.author.id)) return msg.reply('Setup already in progress. Type `!cancel` to restart.');
    setupState.set(msg.author.id, { step: 0 });
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Setup Started')
      .setDescription('I\'ll walk you through each config value. Type `!cancel` at any time to stop.');
    await msg.reply({ embeds: [embed] });
    await sendSetupStep(msg.author.id, msg.channel);
    return;
  }

  if (msg.content === '!help') {
    const member = await msg.guild.members.fetch(msg.author.id);
    const admin = isAdmin(member);
    const inTicket = tickets.has(msg.channel.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📖 Commands')
      .setDescription('**Everyone**\n`!ping` — Check bot is alive\n`!feeds` — List monitored feeds\n`!ticket <msg>` — Submit a support ticket\n`!help` — Show this message');
    if (inTicket) {
      embed.addFields({ name: '🎫 Ticket', value: '`!ticketinfo` — View ticket details\n`!close` — Close ticket (admin)\n`!priority <low|medium|high>` — Set priority (admin)\n`!assign @user` — Assign to admin (admin)' });
    }
    if (admin) {
      embed.addFields({ name: '🔒 Admin', value: '`!setup` — First-time config wizard\n`!addfeed <url>` — Add a new feed\n`!removefeed <#>` — Remove feed by number\n`!config set <KEY> <value>` — Set config manually\n`!config show` — View current config\n`!stats` — View bot statistics' });
    }
    await msg.reply({ embeds: [embed] });
  }

  if (msg.content === '!feeds') {
    const list = ALL_FEEDS.map((f, i) => `${i + 1}. ${getPlatformFromUrl(f).name}: ${f}`).join('\n');
    await msg.reply(list || 'No feeds configured. Use `!addfeed <url>` to add one.');
  }

  if (msg.content === '!stats') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Bot Stats')
      .addFields(
        { name: 'Feeds', value: `${ALL_FEEDS.length}`, inline: true },
        { name: 'Posts Sent', value: `${stats.postsSent}`, inline: true },
        { name: 'Errors', value: `${stats.errors.length}`, inline: true },
        { name: 'Last Check', value: stats.lastCheck ? `<t:${Math.floor(stats.lastCheck.getTime() / 1000)}:R>` : 'Never', inline: true }
      )
      .setTimestamp();
    await msg.reply({ embeds: [embed] });
  }

  if (msg.content.startsWith('!addfeed ')) {
    const member = await msg.guild.members.fetch(msg.author.id);
    if (!isAdmin(member)) return msg.reply('Admin only.');
    let url = msg.content.slice(9).trim();
    if (url.startsWith('/')) url = (cfg.RSSHUB_BASE_URL || '') + url;
    if (!url.startsWith('http')) return msg.reply('Invalid URL. Use a full URL or relative path like `/tiktok/user/name`.');
    if (ALL_FEEDS.includes(url)) return msg.reply('Feed already exists.');
    ALL_FEEDS.push(url);
    saveFeeds();
    await msg.reply(`Added: ${url}`);
  }

  if (msg.content.startsWith('!removefeed ')) {
    const member = await msg.guild.members.fetch(msg.author.id);
    if (!isAdmin(member)) return msg.reply('Admin only.');
    const idx = parseInt(msg.content.slice(12)) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= ALL_FEEDS.length) return msg.reply('Invalid feed number. Use `!feeds` to see list.');
    const removed = ALL_FEEDS.splice(idx, 1)[0];
    saveFeeds();
    await msg.reply(`Removed: ${removed}`);
  }

  if (msg.content === '!config show') {
    const member = await msg.guild.members.fetch(msg.author.id);
    if (!isAdmin(member)) return msg.reply('Admin only.');
    const display = Object.entries(cfg).map(([k, v]) => `${k} = ${SENSITIVE_KEYS.includes(k) ? '***' : v}`);
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('⚙️ Config').setDescription(display.join('\n') || 'No config set.');
    await msg.reply({ embeds: [embed] });
  }

  if (msg.content.startsWith('!config set ')) {
    const member = await msg.guild.members.fetch(msg.author.id);
    if (!isAdmin(member)) return msg.reply('Admin only.');
    const rest = msg.content.slice(12).trim();
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx < 0) return msg.reply('Usage: `!config set <KEY> <value>`');
    const key = rest.slice(0, spaceIdx).toUpperCase();
    const value = rest.slice(spaceIdx + 1).trim();
    cfg[key] = value;
    saveConfig(cfg);
    writeEnv(cfg);
    await msg.reply(`Set \`${key}\` = ${SENSITIVE_KEYS.includes(key) ? '***' : value}`);
    if (RSSHUB_KEYS.includes(key)) {
      const ok = restartRsshub();
      await msg.reply(ok ? 'RSSHub restarted.' : 'RSSHub restart failed — check server.');
    }
  }

  if (msg.content.startsWith('!ticket ')) {
    const message = msg.content.slice(8).trim();
    if (!message) return msg.reply('Usage: !ticket <message>');
    const adminChannel = client.channels.cache.get(cfg.ADMIN_CHANNEL_ID);
    if (!adminChannel) return msg.reply('Admin channel not configured.');

    let thread;
    try {
      thread = await adminChannel.threads.create({
        name: `ticket-${++ticketCounter}`,
        reason: `Ticket from ${msg.author.tag}`,
      });
    } catch {
      return msg.reply('Failed to create ticket. Bot needs Manage Threads permission.');
    }
    await thread.send(`**Ticket #${ticketCounter}** from <@${msg.author.id}>\n\n${message}`);
    try {
      await thread.members.add(msg.author.id);
    } catch {}
    tickets.set(thread.id, { submitterId: msg.author.id, ticketId: ticketCounter, priority: 'medium', assignedTo: null });
    await msg.reply(`Ticket #${ticketCounter} created. An admin will respond shortly.`);
  }

  // Ticket thread handling
  if (tickets.has(msg.channel.id)) {
    const ticket = tickets.get(msg.channel.id);
    const member = await msg.guild.members.fetch(msg.author.id);
    const admin = isAdmin(member);
    const priorityEmoji = { low: '🟢', medium: '🟡', high: '🔴' };

    if (msg.content === '!closed' || msg.content === '!close') {
      if (!admin) return msg.reply('Admins only.');
      try { await msg.channel.members.remove(ticket.submitterId); } catch {}
      await msg.channel.setArchived(true, 'Ticket resolved');
      tickets.delete(msg.channel.id);
      await msg.reply('Ticket closed.');
      return;
    }

    if (msg.content.startsWith('!priority ')) {
      if (!admin) return msg.reply('Admins only.');
      const p = msg.content.slice(10).trim().toLowerCase();
      if (!['low', 'medium', 'high'].includes(p)) return msg.reply('Usage: `!priority <low|medium|high>`');
      ticket.priority = p;
      await msg.reply(`${priorityEmoji[p]} Priority set to **${p}**`);
      return;
    }

    if (msg.content.startsWith('!assign ')) {
      if (!admin) return msg.reply('Admins only.');
      const target = msg.mentions.users.first();
      if (!target) return msg.reply('Usage: `!assign @user`');
      ticket.assignedTo = target.id;
      await msg.reply(`Assigned to <@${target.id}>`);
      return;
    }

    if (msg.content === '!ticketinfo') {
      const embed = new EmbedBuilder()
        .setColor(ticket.priority === 'high' ? 0xED4245 : ticket.priority === 'low' ? 0x57F287 : 0xFEE75C)
        .setTitle(`Ticket #${ticket.ticketId}`)
        .addFields(
          { name: 'Submitter', value: `<@${ticket.submitterId}>`, inline: true },
          { name: 'Priority', value: `${priorityEmoji[ticket.priority]} ${ticket.priority}`, inline: true },
          { name: 'Assigned', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'Unassigned', inline: true }
        );
      await msg.reply({ embeds: [embed] });
      return;
    }

    // Admin reply → DM submitter, fallback to thread mention
    if (msg.author.id !== ticket.submitterId) {
      try {
        const submitter = await client.users.fetch(ticket.submitterId);
        await submitter.send(`**Admin reply to Ticket #${ticket.ticketId}:**\n${msg.content}`);
      } catch {
        await msg.channel.send(`<@${ticket.submitterId}> ^ read above`);
      }
    }
  }
});

// ── Web Dashboard ──────────────────────────────────────────────────────────
const WEB_PORT = parseInt(process.env.WEB_PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(body); }
    });
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function checkAuth(req, res) {
  if (!ADMIN_PASSWORD) return true;
  if (req.headers['x-admin-password'] === ADMIN_PASSWORD) return true;
  json(res, 401, { error: 'Wrong password' });
  return false;
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // API routes
  if (req.url === '/api/config' && req.method === 'GET') {
    if (!checkAuth(req, res)) return;
    const display = {};
    for (const [k, v] of Object.entries(cfg)) {
      display[k] = SENSITIVE_KEYS.includes(k) ? '***' : v;
    }
    return json(res, 200, display);
  }

  if (req.url === '/api/config' && req.method === 'POST') {
    if (!checkAuth(req, res)) return;
    const body = await readBody(req);
    for (const [k, v] of Object.entries(body)) {
      if (k === 'ADMIN_PASSWORD') continue;
      cfg[k] = String(v);
    }
    saveConfig(cfg);
    writeEnv(cfg);
    const rsshubChanged = Object.keys(body).some((k) => RSSHUB_KEYS.includes(k));
    let rsshubRestarted = null;
    if (rsshubChanged) rsshubRestarted = restartRsshub();
    return json(res, 200, { ok: true, rsshubRestarted });
  }

  if (req.url === '/api/feeds' && req.method === 'GET') {
    if (!checkAuth(req, res)) return;
    return json(res, 200, ALL_FEEDS.map((f, i) => ({ index: i, url: f, platform: getPlatformFromUrl(f) })));
  }

  if (req.url === '/api/feeds' && req.method === 'POST') {
    if (!checkAuth(req, res)) return;
    const body = await readBody(req);
    let url = (body.url || '').trim();
    if (url.startsWith('/')) url = (cfg.RSSHUB_BASE_URL || '') + url;
    if (!url.startsWith('http')) return json(res, 400, { error: 'Invalid URL' });
    if (ALL_FEEDS.includes(url)) return json(res, 400, { error: 'Feed already exists' });
    ALL_FEEDS.push(url);
    saveFeeds();
    return json(res, 200, { ok: true, feeds: ALL_FEEDS });
  }

  if (req.url.startsWith('/api/feeds/') && req.method === 'DELETE') {
    if (!checkAuth(req, res)) return;
    const idx = parseInt(req.url.split('/').pop());
    if (Number.isNaN(idx) || idx < 0 || idx >= ALL_FEEDS.length) return json(res, 400, { error: 'Invalid index' });
    const removed = ALL_FEEDS.splice(idx, 1)[0];
    saveFeeds();
    return json(res, 200, { ok: true, removed, feeds: ALL_FEEDS });
  }

  if (req.url === '/api/stats' && req.method === 'GET') {
    if (!checkAuth(req, res)) return;
    return json(res, 200, {
      feeds: ALL_FEEDS.length,
      postsSent: stats.postsSent,
      errors: stats.errors.length,
      lastCheck: stats.lastCheck,
      botUser: client.user?.tag || 'Not connected',
      uptime: process.uptime(),
    });
  }

  if (req.url === '/api/restart-rsshub' && req.method === 'POST') {
    if (!checkAuth(req, res)) return;
    const ok = restartRsshub();
    return json(res, 200, { ok });
  }

  // Static files
  serveStatic(req, res);
});

server.listen(WEB_PORT, () => console.log(`Dashboard: http://localhost:${WEB_PORT}`));

client.login(process.env.DISCORD_TOKEN);