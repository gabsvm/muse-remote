// muse-remote backend — puente HTTP(127.0.0.1) -> MSP oficial (muse serve por stdio).
// Sin clientes de Model API ni API keys PAYG: toda inferencia la ejecuta el
// Muse Code CLI oficial autenticado con el login/subscription del usuario.
// Protocolo: JSON-RPC 2.0 NDJSON por stdio (ver ARCHITECTURE.md y `muse schema`).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

// Solo loopback. Nunca 0.0.0.0 ni exposicion publica (el acceso remoto lo
// proporciona el usuario con Tailscale Serve por fuera de esta app).
const HOST = '127.0.0.1';
const PORT = Number(process.env.MUSE_REMOTE_PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOKEN_FILE = path.join(__dirname, '.token');

// Metodos gestionados internamente por el puente; no se exponen en /api/rpc.
const DENIED_METHODS = new Set(['initialize', 'initialized']);

function loadOrCreateToken() {
  if (process.env.MUSE_REMOTE_TOKEN && process.env.MUSE_REMOTE_TOKEN.length >= 16) {
    return process.env.MUSE_REMOTE_TOKEN;
  }
  try {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved.length >= 16) return saved;
  } catch { /* no existe: generar */ }
  const tok = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, tok + '\n', { mode: 0o600 });
  return tok;
}
const AUTH_TOKEN = loadOrCreateToken();

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// UUIDv7 minimo para los commandId que exige MSP (SS2.5/SS3.1.1).
function uuidv7() {
  const b = crypto.randomBytes(16);
  const ms = BigInt(Date.now());
  b[0] = Number((ms >> 40n) & 0xffn);
  b[1] = Number((ms >> 32n) & 0xffn);
  b[2] = Number((ms >> 24n) & 0xffn);
  b[3] = Number((ms >> 16n) & 0xffn);
  b[4] = Number((ms >> 8n) & 0xffn);
  b[5] = Number(ms & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function resolveMuseBin() {
  if (process.env.MUSE_BIN && fs.existsSync(process.env.MUSE_BIN)) return { file: process.env.MUSE_BIN, shell: false };
  const dir = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Programs', 'muse');
  try {
    const cands = fs.readdirSync(dir).filter((f) => /^muse-bin-.*\.exe$/.test(f)).sort();
    if (cands.length) return { file: path.join(dir, cands[cands.length - 1]), shell: false };
  } catch { /* seguir */ }
  return { file: 'muse', shell: true }; // PATH (shim muse.cmd en Windows)
}

// ---- Puente MSP (un unico proceso `muse serve` propiedad de este backend) ----
class MspHost {
  constructor() {
    this.child = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve,reject,timer}
    this.listeners = new Set(); // fn(msg) para SSE/broadcast
    this.ready = false;
    this.serverInfo = null;
    this.starting = false;
  }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { for (const fn of [...this.listeners]) { try { fn(msg); } catch { /* no tumbar el puente */ } } }

  start() {
    if (this.starting || this.child) return;
    this.starting = true;
    const { file, shell } = resolveMuseBin();
    const child = spawn(file, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'], shell });
    this.child = child;
    child.stdout.on('data', (d) => this.onData(d.toString()));
    child.stderr.on('data', (d) => { this.lastStderr = d.toString().slice(0, 500); });
    child.on('exit', (code) => {
      this.starting = false;
      this.child = null;
      this.ready = false;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('msp host exited')); }
      this.pending.clear();
      this.emit({ __bridge: 'host-down', code });
      if (!this.closed) setTimeout(() => this.start(), 2000); // sesiones durables: resume tras reinicio
    });
    child.on('error', (e) => { this.lastError = String(e).slice(0, 300); });
    // Handshake SS1.4.1: initialize -> initialized (notificacion).
    this.rawRequest('initialize', {
      clientInfo: { name: 'muse_remote', version: '0.1.0' },
      // userShell: autoriza session/userShell; userInputDialogs: declara que
      // la PWA sí renderiza y responde prompts interactivos del modelo.
      capabilities: { requestedCapabilities: ['userShell'], userInputDialogs: true },
    }, 30000)
      .then((res) => {
        this.serverInfo = res;
        this.ready = true;
        this.starting = false;
        try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n'); } catch { /* noop */ }
        this.emit({ __bridge: 'host-up', serverInfo: res });
      })
      .catch((e) => {
        this.lastError = String(e).slice(0, 300);
        this.starting = false;
        try { child.kill(); } catch { /* noop */ }
      });
  }

  onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this.onMessage(msg);
    }
  }

  onMessage(msg) {
    // Peticion iniciada por el servidor (approval/request, userInput/request):
    // se responde recibo de presentacion SS5.3.3 y se difunde a la UI.
    if (msg.method && msg.id !== undefined && msg.result === undefined && msg.error === undefined) {
      try {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
      } catch { /* noop */ }
      this.emit(msg);
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'msp error'), { code: msg.error.code, data: msg.error.data }));
      else p.resolve(msg.result);
      return;
    }
    // Notificacion (item/*, turn/*, session/*, approval/*, ...): difundir.
    this.emit(msg);
  }

  shutdown() {
    this.closed = true;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('msp shutdown')); }
    this.pending.clear();
    if (this.child) {
      const c = this.child;
      this.child = null;
      this.ready = false;
      try { c.kill(); } catch { /* noop */ }
    }
  }

  rawRequest(method, params, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('msp host not running'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('msp timeout: ' + method));
      }, timeoutMs);
      // Evitar que un timer largo retenga el proceso en tests.
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      const frame = { jsonrpc: '2.0', id, method };
      if (params && Object.keys(params).length) frame.params = params;
      try {
        this.child.stdin.write(JSON.stringify(frame) + '\n');
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  request(method, params) {
    if (!this.ready) return Promise.reject(Object.assign(new Error('msp host not ready'), { code: 503 }));
    if (DENIED_METHODS.has(method)) return Promise.reject(Object.assign(new Error('method managed by bridge'), { code: 403 }));
    return this.rawRequest(method, params || {});
  }
}
const msp = new MspHost();

// ---- HTTP ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function authorized(req, tokenFromQuery) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && timingSafeEqual(h.slice(7), AUTH_TOKEN)) return true;
  if (tokenFromQuery && timingSafeEqual(tokenFromQuery, AUTH_TOKEN)) return true;
  return false;
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const parts = [];
    req.on('data', (d) => {
      n += d.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      parts.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const pathname = u.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, mspReady: msp.ready, serverInfo: msp.serverInfo, version: '0.1.0' });
  }
  if (req.method === 'GET' && pathname === '/api/command-id') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return sendJson(res, 200, { ok: true, commandId: uuidv7() });
  }
  if (req.method === 'POST' && pathname === '/api/rpc') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }
    if (!body || typeof body.method !== 'string') return sendJson(res, 400, { ok: false, error: 'method required' });
    if (DENIED_METHODS.has(body.method)) return sendJson(res, 403, { ok: false, error: 'method managed by bridge' });
    try {
      const result = await msp.request(body.method, body.params || {});
      return sendJson(res, 200, { ok: true, result });
    } catch (e) {
      const code = e.code === 503 ? 503 : 502;
      return sendJson(res, code, { ok: false, error: String((e && e.message) || e), mspCode: e.code });
    }
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    const sessionId = u.searchParams.get('sessionId');
    if (!sessionId) { console.error('[events] 400 sin sessionId'); return sendJson(res, 400, { ok: false, error: 'sessionId required' }); }
    if (!authorized(req, u.searchParams.get('token'))) { console.error('[events] 401 token invalido'); return sendJson(res, 401, { ok: false, error: 'unauthorized' }); }
    if (!msp.ready) { console.error('[events] 503 msp no listo'); return sendJson(res, 503, { ok: false, error: 'msp host not ready' }); }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* cliente ido */ }
    };
    const off = msp.onEvent((msg) => {
      if (msg.__bridge) { send('bridge', msg); return; }
      const sid = msg.params && msg.params.sessionId;
      if (sid && sid !== sessionId) return; // multiplexar por sesion
      if (msg.method) send(msg.method, { id: msg.id, params: msg.params });
      else if (msg.result !== undefined || msg.error) send('response', msg);
      else send('message', msg);
    });
    // Ping nominal (visible para el watchdog del cliente) + comentario de keepalive.
    const keep = setInterval(() => {
      try { res.write('event: ping\ndata: {}\n\n: ping\n\n'); } catch { /* noop */ }
    }, 25000);
    if (keep.unref) keep.unref();
    req.on('close', () => { clearInterval(keep); off(); });
    // Suscripcion live a la vista (SS4.7.1). Desde "ahora" si no hay cursor.
    const after = u.searchParams.get('after');
    try {
      const sub = await msp.request('view/subscribe', after ? { sessionId, after } : { sessionId });
      send('subscribed', sub || {});
    } catch (e) {
      console.error('[events] subscribe fallo: ' + String((e && e.message) || e));
      send('error', { error: String((e && e.message) || e) });
    }
    return;
  }
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405);
  res.end();
});

if (require.main === module) {
  msp.start();
  server.listen(PORT, HOST, () => {
    console.log(`muse-remote en http://${HOST}:${PORT}`);
    console.log('Token local (guardalo en el telefono): ' + AUTH_TOKEN);
    if (!process.env.MUSE_REMOTE_TOKEN) console.log('(generado en .token; borralo para rotar)');
  });
}

module.exports = { server, msp, uuidv7, HOST, loadOrCreateToken };
