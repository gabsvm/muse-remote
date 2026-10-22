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
const { PushStore, pushForMsp } = require('./push');
const { writeUpload, readUploadBody } = require('./uploads');

// Solo loopback. Nunca 0.0.0.0 ni exposicion publica (el acceso remoto lo
// proporciona el usuario con Tailscale Serve por fuera de esta app).
const HOST = '127.0.0.1';
const PORT = Number(process.env.MUSE_REMOTE_PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOKEN_FILE = path.join(__dirname, '.token');

// Fail-closed contra META_API_KEY (clave de Model API de pago).
// El backend NUNCA usa Model API: toda inferencia la ejecuta `muse serve`
// con el login/subscription local. Si META_API_KEY esta definida en el
// entorno, el backend se niega a arrancar (fail-closed) para no mezclar
// facturacion PAYG con el puente local.
// NOTA: esto solo sanea el entorno del proceso e hijo. Una API key
// almacenada DENTRO de la configuracion interna de Muse (ficheros del CLI,
// login persistido) NO se detecta ni se elimina aqui: requiere verificacion
// separada por el usuario (p. ej. revisar la configuracion/auth del CLI y
// que `model/list` responda provider `meta` por subscription).
const META_ENV_KEY = 'META_API_KEY';
function assertNoMetaApiKey(env = process.env) {
  const v = env[META_ENV_KEY];
  if (v !== undefined && String(v).trim() !== '') {
    throw new Error(
      'fail-closed: ' + META_ENV_KEY + ' esta definida; el backend se niega a arrancar ' +
      '(desactivala con `$env:' + META_ENV_KEY + '=$null` y reintenta)'
    );
  }
}
// Entorno saneado para el hijo `muse serve`: nunca hereda META_API_KEY
// aunque el padre la tuviera (defensa en profundidad junto al fail-closed).
function childEnvWithoutMetaKey(env = process.env) {
  const next = { ...env };
  delete next[META_ENV_KEY];
  return next;
}

// Allowlist de metodos MSP realmente usados por esta app (PWA + puente
// interno). Todo lo demas por /api/rpc se rechaza con 403. `initialize` e
// `initialized` los gestiona el puente y no se exponen. `view/subscribe` se
// usa internamente en /api/events (SSE) y tambien se permite por /api/rpc
// para sondas.
const ALLOWED_METHODS = new Set([
  'session/list', 'session/start', 'session/resume', 'session/read',
  'session/fork', 'session/compact', 'session/setModel',
  'session/setReasoningEffort', 'session/setApprovalMode', 'session/userShell',
  'turn/start', 'turn/steer', 'turn/unqueue', 'turn/interrupt',
  'view/page', 'view/subscribe',
  'model/list', 'skill/list', 'usage/read',
  'item/readOutput',
  'task/background', 'task/stop',
  'subagent/sendMessage', 'subagent/followupTask', 'subagent/stop',
  'approval/decide', 'approval/listPending',
  'userInput/answer',
]);

// Limites explicitos de cuerpo/imagen (punto 3).
// El cliente genera JPEG (max 1568 px lado mayor, q0.85) en base64: en la
// practica <1 MiB, pero 256 KiB lo rechazaba. 5 MiB de cuerpo RPC deja
// margen al base64+JSON sin abrir la puerta a DoS por cuerpos gigantes.
// La parte `image` individual se acota a 4 MiB de base64 (~3 MiB binarios).
const RPC_BODY_LIMIT = 5 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = 4 * 1024 * 1024;

// Timeouts MSP por metodo. `session/list` puede tardar ~105 s en esta
// maquina (verificado: escanea sesiones en disco al primer listado), asi que
// tiene presupuesto propio de 180 s. El resto mantiene 90 s; no se sube el
// global para no enmascarar cuelgues reales de otros metodos.
const DEFAULT_MSP_TIMEOUT = 90000;
const SESSION_LIST_TIMEOUT = 180000;
const METHOD_TIMEOUTS = { 'session/list': SESSION_LIST_TIMEOUT };
function timeoutForMethod(method) { return METHOD_TIMEOUTS[method] || DEFAULT_MSP_TIMEOUT; }

function loadOrCreateToken(tokenFile = TOKEN_FILE, env = process.env) {
  if (env.MUSE_REMOTE_TOKEN && env.MUSE_REMOTE_TOKEN.length >= 16) {
    return env.MUSE_REMOTE_TOKEN;
  }
  // Two independent processes (CI workers, CLI + service) can start at the
  // same time. Never overwrite an existing token: that would revoke a device
  // silently, or make another process accept a token different from disk.
  const readSaved = () => {
    try {
      const saved = fs.readFileSync(tokenFile, 'utf8').trim();
      return saved.length >= 16 ? saved : null;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
  const saved = readSaved();
  if (saved) return saved;
  const tok = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(tokenFile, tok + '\n', { mode: 0o600, flag: 'wx' });
    return tok;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  // Another process created the file. Its write may not have finished yet.
  // Bounded wait prevents accidentally generating a second token or masking
  // permissions/read errors (which must fail closed).
  for (let i = 0; i < 25; i++) {
    const current = readSaved();
    if (current) return current;
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, 20);
  }
  throw new Error('Existing Muse Remote token file is unreadable or invalid; refusing to replace it');
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
    const child = spawn(file, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'], shell, env: childEnvWithoutMetaKey() });
    this.child = child;
    // Sin este handler, escribir en el stdin de un hijo muerto (EPIPE) emite
    // un 'error' asincrono no capturado que tumba todo el backend.
    child.stdin.on('error', (e) => { this.lastError = String(e).slice(0, 300); });
    child.stdout.setEncoding('utf8'); // no partir caracteres multibyte entre chunks
    child.stdout.on('data', (d) => this.onData(d));
    child.stderr.on('data', (d) => { this.lastStderr = d.toString().slice(0, 500); });
    child.on('exit', (code) => {
      if (this.child !== child) return; // hijo antiguo (tras shutdown/reinicio)
      this.starting = false;
      this.child = null;
      this.buf = '';
      this.ready = false;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('msp host exited')); }
      this.pending.clear();
      this.emit({ __bridge: 'host-down', code });
      if (!this.closed) {
        const t = setTimeout(() => this.start(), 2000); // sesiones durables: resume tras reinicio
        if (t.unref) t.unref();
      }
    });
    child.on('error', (e) => { this.lastError = String(e).slice(0, 300); });
    // Handshake SS1.4.1: initialize -> initialized (notificacion).
    this.rawRequest('initialize', {
      clientInfo: { name: 'muse_remote', version: '0.2.0-beta.1' },
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
        if (this.child) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
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

  rawRequest(method, params, timeoutMs = timeoutForMethod(method)) {
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
    if (!ALLOWED_METHODS.has(method)) return Promise.reject(Object.assign(new Error('method not allowed'), { code: 403 }));
    return this.rawRequest(method, params || {});
  }
}
const msp = new MspHost();

// Web Push: avisa al movil aunque la PWA este cerrada. Las peticiones del
// host (approval/request, userInput/request) llegan siempre al puente; el
// resto (turn/completed) mientras alguna vista este suscrita.
const push = new PushStore();
msp.onEvent((msg) => {
  const n = pushForMsp(msg);
  if (!n || push.seen(n.key) || !push.list().length) return;
  push.send(n.msg, { urgency: n.urgency }).catch(() => { /* noop */ });
});

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

// CSP compatible con la PWA (mismo origen, sin scripts externos; imagenes
// en data:/blob: para preview/adjuntos; estilos inline via 'unsafe-inline'
// porque index.html usa atributos style y app.js fija cssText).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'worker-src \'self\'',
  "manifest-src 'self'",
].join('; ');
function setSecurityHeaders(res) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
}

// no-transform: Cloudflare no comprime (comprimir obliga a acumular y el
// directo llegaba solo al recargar). x-accel-buffering: idem para nginx.
const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'content-encoding': 'identity',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  setSecurityHeaders(res);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

// Solo Authorization: Bearer. El streaming usa fetch (no EventSource), que
// si permite cabeceras, asi que el token NUNCA viaja en query string
// (evita que quede en logs/historial). Un ?token= presente se ignora.
function authorized(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && timingSafeEqual(h.slice(7), AUTH_TOKEN)) return true;
  return false;
}

function isBodyTooLarge(e) { return !!e && e.message === 'body too large'; }

function readBody(req, limit = RPC_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let n = 0;
    let tooLarge = false;
    const parts = [];
    req.on('data', (d) => {
      n += d.length;
      if (tooLarge) return; // drenar el resto sin guardar (respuesta 413 al final)
      if (n > limit) {
        tooLarge = true;
        parts.length = 0; // liberar lo acumulado
        return;
      }
      parts.push(d);
    });
    req.on('end', () => {
      if (tooLarge) reject(new Error('body too large'));
      else resolve(Buffer.concat(parts).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad path' });
  }
  if (rel.includes('\0')) return sendJson(res, 400, { ok: false, error: 'bad path' });
  if (rel === '/') rel = '/index.html';
  // Normalizar contra PUBLIC_DIR y exigir containment estricto (con
  // separador): bloquea /..%2fserver.js, /%2e%2e/, backslashes y prefijos
  // hermanos tipo /public-evil.
  const relSlashed = rel.startsWith('/') ? rel : '/' + rel;
  const file = path.normalize(path.join(PUBLIC_DIR, '.' + relSlashed));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { ok: false, error: 'forbidden' });
  }
  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) {
      setSecurityHeaders(res);
      res.writeHead(404);
      res.end('not found');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        setSecurityHeaders(res);
        res.writeHead(404);
        res.end('not found');
        return;
      }
      setSecurityHeaders(res);
      // no-cache: el navegador/SW revalida siempre y nunca sirve una PWA vieja.
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
}

// Rechaza partes `image` gigantes antes de tocar MSP (413 explicito).
function imagePartTooLarge(params) {
  const input = params && params.input;
  if (!Array.isArray(input)) return false;
  for (const p of input) {
    if (p && p.type === 'image' && typeof p.base64Data === 'string') {
      if (p.base64Data.length > MAX_IMAGE_BASE64_CHARS) return true;
    }
  }
  return false;
}

const server = http.createServer(onRequest);
function onRequest(req, res) {
  handle(req, res).catch((e) => {
    console.error('[http] error no capturado: ' + String((e && e.message) || e));
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
    else { try { res.end(); } catch { /* noop */ } }
  });
}
async function handle(req, res) {
  let u;
  try {
    u = new URL(req.url, 'http://x');
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request' });
  }
  const pathname = u.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, mspReady: msp.ready, ...(authorized(req) ? { serverInfo: msp.serverInfo } : {}), version: '0.2.0-beta.1', features: { fileUpload: true } });
  }
  if (req.method === 'GET' && pathname === '/api/command-id') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return sendJson(res, 200, { ok: true, commandId: uuidv7() });
  }
  if (pathname === '/api/push/key' && req.method === 'GET') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return sendJson(res, 200, { ok: true, publicKey: push.publicKey() });
  }
  if ((pathname === '/api/push/subscribe' || pathname === '/api/push/unsubscribe') && req.method === 'POST') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    let body;
    try { body = JSON.parse(await readBody(req, 16 * 1024)); }
    catch (e) { return sendJson(res, isBodyTooLarge(e) ? 413 : 400, { ok: false, error: 'bad json' }); }
    const sub = body && body.subscription;
    if (pathname === '/api/push/unsubscribe') {
      if (sub && typeof sub.endpoint === 'string') push.remove(sub.endpoint);
      return sendJson(res, 200, { ok: true });
    }
    try { push.add(sub); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    if (body.test) push.send({ title: 'Muse Remote', body: 'Notificaciones activadas', tag: 'test' }).catch(() => {});
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/upload') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/octet-stream')
      return sendJson(res, 415, { ok: false, error: 'expected binary upload' });
    let filename;
    try { filename = decodeURIComponent(String(req.headers['x-muse-filename'] || '')); }
    catch { return sendJson(res, 400, { ok: false, error: 'invalid filename' }); }
    try {
      const payload = await readUploadBody(req);
      const file = await writeUpload(payload, filename);
      return sendJson(res, 200, { ok: true, file });
    } catch (e) {
      const message = String(e.message || e);
      const status = /too large|storage limit|empty/.test(message) ? 413 : 400;
      return sendJson(res, status, { ok: false, error: message });
    }
  }
  if (req.method === 'POST' && pathname === '/api/rpc') {
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    let body;
    try { body = JSON.parse(await readBody(req, RPC_BODY_LIMIT)); }
    catch (e) {
      if (isBodyTooLarge(e)) return sendJson(res, 413, { ok: false, error: 'body too large' });
      return sendJson(res, 400, { ok: false, error: 'bad json' });
    }
    if (!body || typeof body.method !== 'string') return sendJson(res, 400, { ok: false, error: 'method required' });
    if (!ALLOWED_METHODS.has(body.method)) return sendJson(res, 403, { ok: false, error: 'method not allowed' });
    if (imagePartTooLarge(body.params)) return sendJson(res, 413, { ok: false, error: 'image too large' });
    try {
      const result = await msp.request(body.method, body.params || {});
      return sendJson(res, 200, { ok: true, result });
    } catch (e) {
      if (e && e.code === 403) return sendJson(res, 403, { ok: false, error: String(e.message || e), mspCode: e.code });
      const code = e.code === 503 ? 503 : 502;
      return sendJson(res, code, { ok: false, error: String((e && e.message) || e), mspCode: e.code });
    }
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    const sessionId = u.searchParams.get('sessionId');
    if (!sessionId) { console.error('[events] 400 sin sessionId'); return sendJson(res, 400, { ok: false, error: 'sessionId required' }); }
    if (!authorized(req)) { console.error('[events] 401 token invalido'); return sendJson(res, 401, { ok: false, error: 'unauthorized' }); }
    if (!msp.ready) { console.error('[events] 503 msp no listo'); return sendJson(res, 503, { ok: false, error: 'msp host not ready' }); }
    setSecurityHeaders(res);
    res.writeHead(200, SSE_HEADERS);
    // Sin Nagle y con relleno inicial: proxies/tuneles (Cloudflare) que
    // acumulan los primeros KB sueltan el stream desde el primer evento.
    try { res.socket.setNoDelay(true); } catch { /* noop */ }
    res.write(':' + ' '.repeat(2048) + '\n\n');
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
    }, 15000);
    if (keep.unref) keep.unref();
    // res 'close' = socket cerrado por el cliente (req 'close' puede
    // dispararse al terminar de leer la peticion en Node moderno).
    let gone = false;
    res.on('close', () => { gone = true; clearInterval(keep); off(); });
    // Suscripcion live a la vista (SS4.7.1). Desde "ahora" si no hay cursor.
    const after = u.searchParams.get('after');
    try {
      const sub = await msp.request('view/subscribe', after ? { sessionId, after } : { sessionId });
      if (!gone) send('subscribed', sub || {});
    } catch (e) {
      console.error('[events] subscribe fallo: ' + String((e && e.message) || e));
      if (!gone) send('error', { error: String((e && e.message) || e) });
    }
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  setSecurityHeaders(res);
  res.writeHead(405, { allow: 'GET, HEAD, POST' });
  res.end();
}

// Evita que un decodeURIComponent invalido u otro error de ruta tumbe el
// servidor: cualquier excepcion no capturada en el handler responde 500.
server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* noop */ }
});

if (require.main === module) {
  try {
    assertNoMetaApiKey();
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exit(1);
  }
  // LAN is opt-in: HTTPS certificate must be provisioned locally; do not
  // turn the existing HTTP loopback listener into a public HTTP server.
  if (process.env.MUSE_REMOTE_LAN === '1') {
    try {
      require('./lan').startLan(onRequest);
    } catch (e) {
      console.error('[LAN] No se pudo activar HTTPS: ' + e.message);
      console.error('[LAN] Ejecuta powershell -File scripts/setup-lan.ps1 y npm install.');
      process.exit(1);
    }
  }
  msp.start();
  server.listen(PORT, HOST, () => {
    console.log(`muse-remote en http://${HOST}:${PORT}`);
    console.log('Token local (guardalo en el telefono): ' + AUTH_TOKEN);
    if (!process.env.MUSE_REMOTE_TOKEN) console.log('(generado en .token; borralo para rotar)');
  });
}

module.exports = {
  server, msp, uuidv7, HOST, loadOrCreateToken,
  ALLOWED_METHODS, RPC_BODY_LIMIT, MAX_IMAGE_BASE64_CHARS, CSP,
  DEFAULT_MSP_TIMEOUT, SESSION_LIST_TIMEOUT, METHOD_TIMEOUTS, timeoutForMethod,
  META_ENV_KEY, assertNoMetaApiKey, childEnvWithoutMetaKey,
  authorized, setSecurityHeaders, imagePartTooLarge, push, SSE_HEADERS,
};
