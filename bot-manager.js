const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const ManagedBot = require('./managed-bot');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'starrbot.json');

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.bots = new Map();
    this.config = this._load();
  }

  _load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) {
      const empty = { adminPassword: '', bots: [] };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(empty, null, 2));
      return empty;
    }
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { return { adminPassword: '', bots: [] }; }
  }

  save() {
    const serializable = { ...this.config, bots: this.config.bots.map(b => ({ ...b })) };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(serializable, null, 2));
  }

  getBots() {
    return this.config.bots.map(b => ({
      id: b.id,
      name: b.name,
      status: this.bots.get(b.id)?.status || 'stopped',
      error: this.bots.get(b.id)?.error || null,
    }));
  }

  getBotConfig(id) {
    return this.config.bots.find(b => b.id === id) || null;
  }

  createBot({ name, token, clientId }) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (this.config.bots.find(b => b.id === id)) throw new Error('Bot with this name already exists');
    const bot = {
      id,
      name,
      token: token || '',
      clientId: clientId || '',
      functions: {
        updates: { enabled: false, sources: [], channelId: '', checkInterval: 15, rsshubUrl: 'http://rsshub:1200' },
        tickets: { enabled: false, channelId: '', adminChannelId: '', adminRoleId: '' },
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

  getAdminPassword() { return this.config.adminPassword; }
  setAdminPassword(pw) { this.config.adminPassword = pw; this.save(); }
}

module.exports = BotManager;
