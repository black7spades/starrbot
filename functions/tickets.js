const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'tickets',
  description: 'Support ticket system with threads and DM relay',
  icon: '\u{1F3AB}',
  defaults: { channelId: '', adminChannelId: '', adminRoleId: '' },
  configFields: [
    { key: 'channelId', label: 'Ticket Channel ID', type: 'text', hint: 'Right-click channel \u2192 Copy Channel ID' },
    { key: 'adminChannelId', label: 'Admin Channel ID', type: 'text', hint: 'Where tickets are created' },
    { key: 'adminRoleId', label: 'Admin Role ID', type: 'text', hint: 'Role that can manage tickets (optional)' },
  ],

  registerCommands(client, config, managedBot) {
    if (!managedBot._tickets) managedBot._tickets = new Map();
    if (!managedBot._ticketCounter) managedBot._ticketCounter = 0;
    const tickets = managedBot._tickets;

    const isAdmin = (member) => !config.adminRoleId || member.roles.cache.has(config.adminRoleId);

    client.on('messageCreate', async (msg) => {
      if (msg.author.bot) return;

      if (msg.content.startsWith('!ticket ')) {
        const message = msg.content.slice(8).trim();
        if (!message) return msg.reply('Usage: !ticket <message>');
        const adminChannel = client.channels.cache.get(config.adminChannelId);
        if (!adminChannel) return msg.reply('Admin channel not configured.');
        let thread;
        try { thread = await adminChannel.threads.create({ name: `ticket-${++managedBot._ticketCounter}`, reason: `Ticket from ${msg.author.tag}` }); }
        catch { return msg.reply('Failed to create ticket. Bot needs Manage Threads permission.'); }
        await thread.send(`**Ticket #${managedBot._ticketCounter}** from <@${msg.author.id}>\n\n${message}`);
        try { await thread.members.add(msg.author.id); } catch {}
        tickets.set(thread.id, { submitterId: msg.author.id, ticketId: managedBot._ticketCounter, priority: 'medium', assignedTo: null });
        managedBot.stats.ticketsCreated++;
        return msg.reply(`Ticket #${managedBot._ticketCounter} created.`);
      }

      if (tickets.has(msg.channel.id)) {
        const ticket = tickets.get(msg.channel.id);
        const member = await msg.guild.members.fetch(msg.author.id);
        const admin = isAdmin(member);
        const priorityEmoji = { low: '\u{1F7E2}', medium: '\u{1F7E1}', high: '\u{1F534}' };

        if (msg.content === '!closed' || msg.content === '!close') {
          if (!admin) return msg.reply('Admins only.');
          try { await msg.channel.members.remove(ticket.submitterId); } catch {}
          await msg.channel.setArchived(true, 'Ticket resolved');
          tickets.delete(msg.channel.id);
          return msg.reply('Ticket closed.');
        }
        if (msg.content.startsWith('!priority ')) {
          if (!admin) return msg.reply('Admins only.');
          const p = msg.content.slice(10).trim().toLowerCase();
          if (!['low', 'medium', 'high'].includes(p)) return msg.reply('Usage: `!priority <low|medium|high>`');
          ticket.priority = p;
          return msg.reply(`${priorityEmoji[p]} Priority set to **${p}**`);
        }
        if (msg.content.startsWith('!assign ')) {
          if (!admin) return msg.reply('Admins only.');
          const target = msg.mentions.users.first();
          if (!target) return msg.reply('Usage: `!assign @user`');
          ticket.assignedTo = target.id;
          return msg.reply(`Assigned to <@${target.id}>`);
        }
        if (msg.content === '!ticketinfo') {
          const embed = new EmbedBuilder().setColor(ticket.priority === 'high' ? 0xED4245 : ticket.priority === 'low' ? 0x57F287 : 0xFEE75C)
            .setTitle(`Ticket #${ticket.ticketId}`).addFields(
              { name: 'Submitter', value: `<@${ticket.submitterId}>`, inline: true },
              { name: 'Priority', value: `${priorityEmoji[ticket.priority]} ${ticket.priority}`, inline: true },
              { name: 'Assigned', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'Unassigned', inline: true }
            );
          return msg.reply({ embeds: [embed] });
        }
        if (msg.author.id !== ticket.submitterId) {
          try { const submitter = await client.users.fetch(ticket.submitterId); await submitter.send(`**Admin reply to Ticket #${ticket.ticketId}:**\n${msg.content}`); }
          catch { await msg.channel.send(`<@${ticket.submitterId}> ^ read above`); }
        }
      }
    });
  },

  start() {},
  stop() {},

  getStats(managedBot) {
    return { active: managedBot._tickets?.size || 0, total: managedBot._ticketCounter || 0 };
  },
};
