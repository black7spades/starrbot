const fs = require('fs');
const http = require('http');
const path = require('path');
const BotManager = require('./bot-manager');

const WEB_PORT = parseInt(process.env.WEB_PORT) || 2013;
const manager = new BotManager();

// ── SSE Clients ──────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch { sseClients.delete(res); } }
}

manager.on('bot:status', (d) => broadcast('bot:status', d));
manager.on('bot:log', (d) => broadcast('bot:log', d));
manager.on('bot:stats', (d) => broadcast('bot:stats', d));

// ── Helpers ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function checkAuth(req) {
  const pw = manager.getAdminPassword();
  if (!pw) return true;
  return req.headers['x-admin-password'] === pw;
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

// ── Token Validation ─────────────────────────────────────────────────────
async function validateToken(token) {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { valid: true, bot: { id: data.id, username: data.username, avatar: data.avatar } };
  } catch (err) { return { valid: false, error: err.message }; }
}

// ── Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // SSE endpoint (no auth check for SSE, but we could add it)
  if (req.url === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('event: connected\ndata: {}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  if (req.url === '/api/status' && req.method === 'GET') {
    const bots = manager.getBots();
    return json(res, 200, {
      configured: bots.length > 0,
      hasPassword: !!manager.getAdminPassword(),
      botCount: bots.length,
    });
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const pw = manager.getAdminPassword();
    if (pw && body.password !== pw) return json(res, 401, { error: 'Wrong password' });
    return json(res, 200, { ok: true });
  }

  if (req.url === '/api/auth/password' && req.method === 'POST') {
    if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (body.password) manager.setAdminPassword(body.password);
    return json(res, 200, { ok: true });
  }

  // All routes below require auth
  if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' });

  // ── Settings ────────────────────────────────────────────────────────────
  if (req.url === '/api/settings' && req.method === 'GET') {
    return json(res, 200, manager.getSettings());
  }
  if (req.url === '/api/settings' && req.method === 'PUT') {
    const body = await readBody(req);
    manager.setSettings(body);
    return json(res, 200, manager.getSettings());
  }

  // ── Function Registry ───────────────────────────────────────────────────
  if (req.url === '/api/functions' && req.method === 'GET') {
    return json(res, 200, manager.getFunctionRegistry());
  }

  // ── Bot CRUD ───────────────────────────────────────────────────────────
  if (req.url === '/api/bots' && req.method === 'GET') {
    return json(res, 200, manager.getBots());
  }

  if (req.url === '/api/bots' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const bot = manager.createBot(body);
      return json(res, 201, bot);
    } catch (err) { return json(res, 400, { error: err.message }); }
  }

  const botMatch = req.url.match(/^\/api\/bots\/([^/]+)$/);
  if (botMatch) {
    const id = botMatch[1];
    if (req.method === 'GET') {
      const bot = manager.getBotConfig(id);
      if (!bot) return json(res, 404, { error: 'Bot not found' });
      const safe = { ...bot, token: bot.token ? '***' : '' };
      return json(res, 200, safe);
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const bot = manager.updateBot(id, body);
      if (!bot) return json(res, 404, { error: 'Bot not found' });
      return json(res, 200, { id: bot.id, name: bot.name });
    }
    if (req.method === 'DELETE') {
      manager.deleteBot(id);
      return json(res, 200, { ok: true });
    }
  }

  // ── Bot Start/Stop ─────────────────────────────────────────────────────
  const startMatch = req.url.match(/^\/api\/bots\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    try {
      await manager.startBot(startMatch[1]);
      return json(res, 200, { ok: true });
    } catch (err) { return json(res, 400, { error: err.message }); }
  }

  const stopMatch = req.url.match(/^\/api\/bots\/([^/]+)\/stop$/);
  if (stopMatch && req.method === 'POST') {
    manager.stopBot(stopMatch[1]);
    return json(res, 200, { ok: true });
  }

  const toggleMatch = req.url.match(/^\/api\/bots\/([^/]+)\/toggle$/);
  if (toggleMatch && req.method === 'POST') {
    const result = manager.toggleBot(toggleMatch[1]);
    if (!result) return json(res, 404, { error: 'Bot not found' });
    return json(res, 200, result);
  }

  // ── Function Config ────────────────────────────────────────────────────
  const funcMatch = req.url.match(/^\/api\/bots\/([^/]+)\/functions\/([^/]+)$/);
  if (funcMatch) {
    const [, botId, funcName] = funcMatch;
    if (req.method === 'GET') {
      const bot = manager.getBotConfig(botId);
      if (!bot) return json(res, 404, { error: 'Bot not found' });
      return json(res, 200, bot.functions[funcName] || null);
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const result = manager.updateFunctionConfig(botId, funcName, body);
      if (!result) return json(res, 404, { error: 'Bot not found' });
      return json(res, 200, result);
    }
  }

  // ── Bot Stats/Logs ─────────────────────────────────────────────────────
  const statsMatch = req.url.match(/^\/api\/bots\/([^/]+)\/stats$/);
  if (statsMatch && req.method === 'GET') {
    const stats = manager.getBotStats(statsMatch[1]);
    return json(res, 200, stats || {});
  }

  const logsMatch = req.url.match(/^\/api\/bots\/([^/]+)\/logs$/);
  if (logsMatch && req.method === 'GET') {
    const logs = manager.getBotLogs(logsMatch[1]);
    return json(res, 200, logs);
  }

  // ── Validate Token ─────────────────────────────────────────────────────
  if (req.url === '/api/validate-token' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await validateToken(body.token);
    return json(res, 200, result);
  }

  // ── OAuth2 URL ─────────────────────────────────────────────────────────
  const oauthMatch = req.url.match(/^\/api\/oauth2-url\/([^/]+)$/);
  if (oauthMatch && req.method === 'GET') {
    const clientId = oauthMatch[1];
    const perms = 2147485696;
    const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot%20applications.commands`;
    return json(res, 200, { url });
  }

  // ── Static Files ───────────────────────────────────────────────────────
  serveStatic(req, res);
});

server.listen(WEB_PORT, () => {
  console.log(`StarrBot dashboard: http://localhost:${WEB_PORT}`);
  const bots = manager.getBots();
  if (bots.length) console.log(`${bots.length} bot(s) configured. Start from dashboard.`);
  else console.log('No bots configured. Open dashboard to create one.');
});
