const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');
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
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const FEEDS_FILE = `${__dirname}/feeds.json`;

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
  return !ADMIN_ROLE_ID || member.roles.cache.has(ADMIN_ROLE_ID);
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
  const channel = client.channels.cache.get(CHANNEL_ID);
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
  console.log(`Monitoring ${ALL_FEEDS.length} feeds every ${CHECK_INTERVAL} minutes`);

  setInterval(checkAllFeeds, CHECK_INTERVAL * 60 * 1000);
  checkAllFeeds();
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === '!ping') {
    await msg.reply('Pong! 🏓');
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
      embed.addFields({ name: '🔒 Admin', value: '`!addfeed <url>` — Add a new feed\n`!removefeed <#>` — Remove feed by number\n`!stats` — View bot statistics' });
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
    if (url.startsWith('/')) url = (process.env.RSSHUB_BASE_URL || '') + url;
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

  if (msg.content.startsWith('!ticket ')) {
    const message = msg.content.slice(8).trim();
    if (!message) return msg.reply('Usage: !ticket <message>');
    const adminChannel = client.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
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

client.login(process.env.DISCORD_TOKEN);