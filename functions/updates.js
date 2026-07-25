const { EmbedBuilder, ChannelType } = require('discord.js');
const Parser = require('rss-parser');
const parser = new Parser();

const PLATFORMS = {
  tiktok: { name: 'TikTok', color: 0x000000, icon: '\u{3B5}' },
  instagram: { name: 'Instagram', color: 0xE4405F, icon: '\u{1F4F8}' },
  youtube: { name: 'YouTube', color: 0xFF0000, icon: '\u{25B6}' },
  twitch: { name: 'Twitch', color: 0x9146FF, icon: '\u{1F7E3}' },
  twitter: { name: 'Twitter', color: 0x1DA1F2, icon: '\u{1F426}' },
  bluesky: { name: 'Bluesky', color: 0x0085FF, icon: '\u{2605}' },
  default: { name: 'Social', color: 0x5865F2, icon: '\u{1F517}' },
};

function getPlatform(url) {
  const lower = url.toLowerCase();
  if (lower.includes('tiktok')) return PLATFORMS.tiktok;
  if (lower.includes('instagram')) return PLATFORMS.instagram;
  if (lower.includes('youtube') || lower.includes('youtu.be')) return PLATFORMS.youtube;
  if (lower.includes('twitch')) return PLATFORMS.twitch;
  if (lower.includes('twitter') || lower.includes('x.com')) return PLATFORMS.twitter;
  if (lower.includes('bsky') || lower.includes('bluesky')) return PLATFORMS.bluesky;
  return PLATFORMS.default;
}

function createEmbed(item, platform) {
  const embed = new EmbedBuilder()
    .setColor(platform.color)
    .setTitle(`${platform.icon} ${platform.name}: ${(item.title || 'New Post').slice(0, 256)}`)
    .setURL(item.link)
    .setTimestamp(new Date(item.pubDate || Date.now()))
    .setFooter({ text: platform.name });
  if (item.contentSnippet) embed.setDescription(item.contentSnippet.slice(0, 4096));
  if (item.enclosure?.url) embed.setImage(item.enclosure.url);
  else if (item['media:content']?.$?.url) embed.setImage(item['media:content'].$.url);
  else if (item['media:thumbnail']?.$?.url) embed.setImage(item['media:thumbnail'].$.url);
  if (item.author) embed.setAuthor({ name: item.author });
  return embed;
}

module.exports = {
  name: 'updates',
  description: 'Monitor social feeds and post updates',
  icon: '\u{1F4E1}',
  commands: [
    { name: 'feeds', description: 'List all monitored feeds', permission: 'everyone' },
    { name: 'stats', description: 'View bot statistics', permission: 'everyone' },
    { name: 'ping', description: 'Check if bot is alive', permission: 'everyone' },
    { name: 'help', description: 'Show all available commands', permission: 'everyone' },
    { name: 'addfeed <url>', description: 'Add a new feed URL', permission: 'admin' },
    { name: 'removefeed <#>', description: 'Remove feed by number', permission: 'admin' },
  ],
  defaults: { sources: [], channelId: '', checkInterval: 15, rsshubUrl: 'http://rsshub:1200' },
  configFields: [
    { key: 'rsshubUrl', label: 'RSSHub URL', type: 'text', hint: 'Your RSSHub instance URL' },
    { key: 'checkInterval', label: 'Check Interval (min)', type: 'number', hint: 'How often to check feeds' },
    { key: 'channelId', label: 'Post Channel ID', type: 'text', hint: 'Right-click channel \u2192 Copy Channel ID' },
  ],

  registerCommands(client, config, managedBot) {
    const P = config.commandPrefix || '!';
    const handler = async (msg) => {
      if (msg.author.bot) return;
      const isAdmin = (member) => !config.adminRoleId || member.roles.cache.has(config.adminRoleId);

      if (msg.content === `${P}feeds`) {
        const list = config.sources.map((s, i) => `${i + 1}. ${s.label || getPlatform(s.url).name}: ${s.url}`).join('\n');
        return msg.reply(list || 'No feeds configured.');
      }

      if (msg.content === `${P}stats`) {
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('\u{1F4CA} Bot Stats').addFields(
          { name: 'Feeds', value: `${config.sources.length}`, inline: true },
          { name: 'Posts Sent', value: `${managedBot.stats.postsSent}`, inline: true },
          { name: 'Errors', value: `${managedBot.stats.errors}`, inline: true },
          { name: 'Last Check', value: managedBot.stats.lastCheck ? `<t:${Math.floor(managedBot.stats.lastCheck.getTime() / 1000)}:R>` : 'Never', inline: true }
        ).setTimestamp();
        return msg.reply({ embeds: [embed] });
      }

      if (msg.content.startsWith(`${P}addfeed `)) {
        const member = await msg.guild.members.fetch(msg.author.id);
        if (!isAdmin(member)) return msg.reply('Admin only.');
        let url = msg.content.slice(P.length + 8).trim();
        if (url.startsWith('/')) url = (config.rsshubUrl || 'http://rsshub:1200') + url;
        if (!url.startsWith('http')) return msg.reply('Invalid URL.');
        if (config.sources.find(s => s.url === url)) return msg.reply('Feed already exists.');
        config.sources.push({ url, label: getPlatform(url).name, platform: 'auto' });
        managedBot.manager.save();
        return msg.reply(`Added: ${url}`);
      }

      if (msg.content.startsWith(`${P}removefeed `)) {
        const member = await msg.guild.members.fetch(msg.author.id);
        if (!isAdmin(member)) return msg.reply('Admin only.');
        const idx = parseInt(msg.content.slice(P.length + 11)) - 1;
        if (Number.isNaN(idx) || idx < 0 || idx >= config.sources.length) return msg.reply('Invalid feed number.');
        const removed = config.sources.splice(idx, 1)[0];
        managedBot.manager.save();
        return msg.reply(`Removed: ${removed.url}`);
      }

      if (msg.content === `${P}help`) {
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('\u{1F4D6} Commands')
          .setDescription(`**Everyone**\n\`${P}ping\` \u2014 Check bot is alive\n\`${P}feeds\` \u2014 List monitored feeds\n\`${P}ticket <msg>\` \u2014 Submit a support ticket\n\`${P}help\` \u2014 Show this message\n\`${P}stats\` \u2014 View bot statistics\n\n**Admin**\n\`${P}addfeed <url>\` \u2014 Add a new feed\n\`${P}removefeed <#>\` \u2014 Remove feed by number`);
        return msg.reply({ embeds: [embed] });
      }

      if (msg.content === `${P}ping`) return msg.reply('Pong! \u{1F3D3}');
    };

    managedBot._updatesHandler = handler;
    client.on('messageCreate', handler);
  },

  start(managedBot, config) {
    if (!managedBot._postedUrls) managedBot._postedUrls = new Set();
    if (!config.sources.length || !config.channelId) return;
    const interval = parseInt(config.checkInterval) || 15;

    managedBot._updatesInterval = setInterval(() => checkAllFeeds(managedBot, config), interval * 60 * 1000);
    checkAllFeeds(managedBot, config);
  },

  stop(managedBot) {
    if (managedBot._updatesInterval) {
      clearInterval(managedBot._updatesInterval);
      managedBot._updatesInterval = null;
    }
    if (managedBot.client && managedBot._updatesHandler) {
      managedBot.client.removeListener('messageCreate', managedBot._updatesHandler);
      managedBot._updatesHandler = null;
    }
  },

  getStats(managedBot) {
    return { postsSent: managedBot.stats.postsSent, errors: managedBot.stats.errors, lastCheck: managedBot.stats.lastCheck };
  },
};

async function checkAllFeeds(managedBot, config) {
  const channel = managedBot.client.channels.cache.get(config.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    managedBot._log('Updates: invalid channel');
    return;
  }
  managedBot.stats.lastCheck = new Date();
  managedBot._log(`Checking ${config.sources.length} feeds...`);

  for (const source of config.sources) {
    const url = source.url.startsWith('/') ? (config.rsshubUrl || 'http://rsshub:1200') + source.url : source.url;
    await checkFeed(url, source, channel, managedBot, config);
  }
}

async function checkFeed(url, source, channel, managedBot, config) {
  try {
    const feed = await parser.parseURL(url);
    const platform = getPlatform(url);
    const interval = parseInt(config.checkInterval) || 15;
    for (const item of feed.items.slice(0, 5).reverse()) {
      if (managedBot._postedUrls.has(item.link)) continue;
      if (item.pubDate && new Date(item.pubDate) < new Date(Date.now() - interval * 60 * 1000 * 2)) continue;
      await channel.send({ embeds: [createEmbed(item, platform)] });
      managedBot._postedUrls.add(item.link);
      managedBot.stats.postsSent++;
      if (managedBot._postedUrls.size > 1000) { const first = managedBot._postedUrls.values().next().value; managedBot._postedUrls.delete(first); }
    }
  } catch (err) {
    managedBot._log(`Feed error (${url}): ${err.message}`);
    managedBot.stats.errors++;
  }
}
