const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const ManagedBot = require('./managed-bot');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'starrbot.json');

function hashPw(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.bots = new Map();
    this.config = this._load();
    this._migrateAuth();
  }

  _load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) {
      const empty = { users: [], commandPrefix: '!', bots: [] };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(empty, null, 2));
      return empty;
    }
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!data.commandPrefix) data.commandPrefix = '!';
      if (!data.bots) data.bots = [];
      if (!data.users) data.users = [];
      return data;
    } catch { return { users: [], commandPrefix: '!', bots: [] }; }
  }

  _migrateAuth() {
    if (this.config.adminPassword && this.config.users.length === 0) {
      this.config.users.push({ id: 'admin', username: 'admin', passwordHash: hashPw(this.config.adminPassword), role: 'admin' });
      delete this.config.adminPassword;
      this.save();
    }
  }

  save() {
    const serializable = { ...this.config, bots: this.config.bots.map(b => ({ ...b })) };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(serializable, null, 2));
  }

  // ── Users ───────────────────────────────────────────────────────────────
  getUsers() {
    return this.config.users.map(u => ({ id: u.id, username: u.username, role: u.role }));
  }

  authenticate(username, password) {
    const user = this.config.users.find(u => u.username === username);
    if (!user) return null;
    if (user.passwordHash !== hashPw(password)) return null;
    return { id: user.id, username: user.username, role: user.role };
  }

  createUser({ username, password, role }) {
    if (this.config.users.find(u => u.username === username)) throw new Error('Username already exists');
    const id = username.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const user = { id, username, passwordHash: hashPw(password), role: role || 'viewer' };
    this.config.users.push(user);
    this.save();
    return { id, username, role: user.role };
  }

  updateUser(id, updates) {
    const user = this.config.users.find(u => u.id === id);
    if (!user) return null;
    if (updates.username) user.username = updates.username;
    if (updates.password) user.passwordHash = hashPw(updates.password);
    if (updates.role) user.role = updates.role;
    this.save();
    return { id: user.id, username: user.username, role: user.role };
  }

  deleteUser(id) {
    this.config.users = this.config.users.filter(u => u.id !== id);
    this.save();
  }

  // ── Bots ────────────────────────────────────────────────────────────────
  getBots() {
    return this.config.bots.map(b => {
      const managed = this.bots.get(b.id);
      const avatarUrl = b.avatarUrl || null;
      return {
        id: b.id,
        name: b.name,
        avatarUrl,
        enabled: b.enabled !== false,
        status: managed?.status || 'stopped',
        error: managed?.error || null,
        guildCount: managed?.client?.guilds?.cache?.size || 0,
        activeFunctions: Object.entries(b.functions || {}).filter(([, v]) => v.enabled).map(([k]) => k),
        allFunctions: Object.keys(b.functions || {}),
      };
    });
  }

  getBotConfig(id) {
    return this.config.bots.find(b => b.id === id) || null;
  }

  createBot({ name, token, clientId, avatarUrl }) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (this.config.bots.find(b => b.id === id)) throw new Error('Bot with this name already exists');
    const bot = {
      id,
      name,
      token: token || '',
      clientId: clientId || '',
      avatarUrl: avatarUrl || null,
      enabled: true,
      functions: {
        updates: { enabled: false, commandPrefix: '', sources: [], channelId: '', checkInterval: 15, rsshubUrl: 'http://rsshub:1200' },
        tickets: { enabled: false, commandPrefix: '', adminChannelId: '', adminRoleId: '' },
      },
    };
    this.config.bots.push(bot);
    this.save();
    return { id, name };
  }

  updateBot(id, updates) {
    const idx = this.config.bots.findIndex(b => b.id === id);
    if (idx < 0) return null;
    if (updates.name) this.config.bots[idx].name = updates.name;
    if (updates.token !== undefined) this.config.bots[idx].token = updates.token;
    if (updates.clientId !== undefined) this.config.bots[idx].clientId = updates.clientId;
    if (updates.avatarUrl !== undefined) this.config.bots[idx].avatarUrl = updates.avatarUrl;
    this.save();
    return this.config.bots[idx];
  }

  deleteBot(id) {
    const managed = this.bots.get(id);
    if (managed) { managed.stop(); this.bots.delete(id); }
    this.config.bots = this.config.bots.filter(b => b.id !== id);
    this.save();
  }

  updateFunctionConfig(botId, funcName, funcConfig) {
    const bot = this.config.bots.find(b => b.id === botId);
    if (!bot) return null;
    if (!bot.functions[funcName]) bot.functions[funcName] = {};
    Object.assign(bot.functions[funcName], funcConfig);
    this.save();
    if (this.bots.get(botId)) this.bots.get(botId).reloadFunctions();
    return bot.functions[funcName];
  }

  async startBot(id) {
    const botConfig = this.config.bots.find(b => b.id === id);
    if (!botConfig) throw new Error('Bot not found');
    if (!botConfig.token) throw new Error('No token configured');
    if (this.bots.has(id)) throw new Error('Bot already running');

    const managed = new ManagedBot(botConfig, this);
    this.bots.set(id, managed);
    await managed.start();
    return managed.status;
  }

  stopBot(id) {
    const managed = this.bots.get(id);
    if (!managed) return;
    managed.stop();
    this.bots.delete(id);
  }

  getBotStats(id) {
    const managed = this.bots.get(id);
    return managed ? managed.getStats() : null;
  }

  getBotLogs(id) {
    const managed = this.bots.get(id);
    return managed ? managed.getLogs() : [];
  }

  getSettings() {
    return { commandPrefix: this.config.commandPrefix || '!' };
  }

  setSettings(updates) {
    if (updates.commandPrefix !== undefined) this.config.commandPrefix = updates.commandPrefix;
    this.save();
  }

  toggleBot(id) {
    const bot = this.config.bots.find(b => b.id === id);
    if (!bot) return null;
    bot.enabled = bot.enabled === false ? true : false;
    this.save();
    return { id, enabled: bot.enabled };
  }

  getFunctionRegistry() {
    const registry = require('./functions');
    return Object.entries(registry).map(([name, fn]) => ({
      name,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      description: fn.description,
      icon: fn.icon,
      commands: fn.commands || [],
      configFields: fn.configFields || [],
    }));
  }
}

module.exports = BotManager;
