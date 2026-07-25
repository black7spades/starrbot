const { Client, GatewayIntentBits } = require('discord.js');
const functions = require('./functions');

class ManagedBot {
  constructor(config, manager) {
    this.config = config;
    this.manager = manager;
    this.client = null;
    this.status = 'stopped';
    this.error = null;
    this.stats = { postsSent: 0, errors: 0, lastCheck: null, ticketsCreated: 0, uptime: null };
    this.logs = [];
    this.loadedFunctions = [];
  }

  _log(msg) {
    const entry = { message: msg, timestamp: new Date() };
    this.logs.push(entry);
    if (this.logs.length > 50) this.logs.shift();
    this.manager.emit('bot:log', { id: this.config.id, ...entry });
  }

  _setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.manager.emit('bot:status', { id: this.config.id, status, error });
  }

  async start() {
    if (this.client) return;
    this._setStatus('starting');
    this._log('Starting bot...');

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    this.client.once('ready', () => {
      this._log(`Logged in as ${this.client.user.tag}`);
      this._setStatus('running');
      this.stats.uptime = Date.now();
      this._loadFunctions();
    });

    this.client.on('error', (err) => {
      this._log(`Client error: ${err.message}`);
      this.stats.errors++;
    });

    try {
      await this.client.login(this.config.token);
    } catch (err) {
      this._log(`Login failed: ${err.message}`);
      this._setStatus('error', err.message);
      this.client = null;
      throw err;
    }
  }

  stop() {
    if (!this.client) return;
    this._log('Stopping bot...');
    this._unloadFunctions();
    this.client.destroy();
    this.client = null;
    this._setStatus('stopped');
    this.stats.uptime = null;
  }

  _loadFunctions() {
    this._unloadFunctions();
    for (const [name, func] of Object.entries(functions)) {
      const config = this.config.functions[name];
      if (config?.enabled) {
        try {
          func.registerCommands(this.client, config, this);
          func.start(this, config);
          this.loadedFunctions.push(name);
          this._log(`Loaded function: ${name}`);
        } catch (err) {
          this._log(`Failed to load ${name}: ${err.message}`);
        }
      }
    }
  }

  _unloadFunctions() {
    for (const name of this.loadedFunctions) {
      try { functions[name]?.stop(this); } catch {}
    }
    this.loadedFunctions = [];
  }

  reloadFunctions() {
    if (this.status !== 'running') return;
    this._unloadFunctions();
    this._loadFunctions();
  }

  getStats() {
    return { ...this.stats, functions: this.loadedFunctions };
  }

  getLogs() {
    return [...this.logs];
  }
}

module.exports = ManagedBot;
