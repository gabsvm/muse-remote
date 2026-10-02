// Web Push sin dependencias: VAPID (RFC 8292) + cifrado aes128gcm (RFC 8291).
// Permite avisar al movil (aprobaciones, preguntas, turno terminado) aunque
// la PWA este cerrada. Las claves VAPID y las suscripciones se guardan junto
// al backend con permisos 0600.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const DIR = __dirname;
const VAPID_FILE = path.join(DIR, '.vapid.json');
const SUBS_FILE = path.join(DIR, '.push-subs.json');
const MAX_SUBS = 20;
const RECORD_SIZE = 4096;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64u(s) { return Buffer.from(String(s || ''), 'base64url'); }

// Clave publica EC P-256 en formato "uncompressed" (65 bytes: 0x04||x||y).
function rawPublicKey(keyObject) {
  const jwk = keyObject.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
}

function generateVapid() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKey: b64u(rawPublicKey(publicKey)),
  };
}
function loadOrCreateVapid(file = VAPID_FILE) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v && v.privateKeyPem && v.publicKey) return v;
  } catch { /* no existe: generar */ }
  const v = generateVapid();
  fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  return v;
}

// JWT ES256 para la cabecera Authorization: vapid t=..., k=...
function vapidJwt(audience, vapid, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: subject }));
  const data = header + '.' + claims;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: vapid.privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return data + '.' + b64u(sig);
}

// Cifra el payload para una suscripcion (RFC 8291, un unico registro).
function encryptPayload(payload, keys, opts = {}) {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh invalida');
  if (authSecret.length < 16) throw new Error('auth invalido');
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivateKey) ecdh.setPrivateKey(opts.asPrivateKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt || crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = ultimo registro
  if (plain.length + 16 > RECORD_SIZE) throw new Error('payload demasiado grande');
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, body]);
}

// Solo endpoints https publicos (evita usar el backend como proxy SSRF).
function validEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (net.isIP(h)) return false;
  return h.includes('.');
}
function validSubscription(sub) {
  return !!sub && typeof sub === 'object' && typeof sub.endpoint === 'string' && sub.endpoint.length < 2048
    && validEndpoint(sub.endpoint) && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
    && fromB64u(sub.keys.p256dh).length === 65 && fromB64u(sub.keys.auth).length >= 16;
}

class PushStore {
  constructor(opts = {}) {
    this.subsFile = opts.subsFile || SUBS_FILE;
    this.vapidFile = opts.vapidFile || VAPID_FILE;
    this.subject = opts.subject || process.env.MUSE_REMOTE_VAPID_SUB || 'mailto:muse-remote@example.com';
    this.fetch = opts.fetch || ((...a) => fetch(...a));
    this.vapid = null;
    this.subs = null;
    this.recent = new Map(); // dedupe de avisos (approval/request + approval/requested)
  }
  keys() { if (!this.vapid) this.vapid = loadOrCreateVapid(this.vapidFile); return this.vapid; }
  publicKey() { return this.keys().publicKey; }
  list() {
    if (!this.subs) {
      try { this.subs = JSON.parse(fs.readFileSync(this.subsFile, 'utf8')).filter(validSubscription); }
      catch { this.subs = []; }
    }
    return this.subs;
  }
  save() {
    try { fs.writeFileSync(this.subsFile, JSON.stringify(this.subs || []), { mode: 0o600 }); } catch { /* noop */ }
  }
  add(sub) {
    if (!validSubscription(sub)) throw new Error('suscripcion invalida');
    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    const list = this.list().filter((s) => s.endpoint !== clean.endpoint);
    list.push(clean);
    this.subs = list.slice(-MAX_SUBS);
    this.save();
  }
  remove(endpoint) {
    const before = this.list().length;
    this.subs = this.list().filter((s) => s.endpoint !== endpoint);
    if (this.subs.length !== before) this.save();
  }
  seen(key) {
    if (!key) return false;
    const now = Date.now();
    for (const [k, t] of this.recent) if (now - t > 10 * 60 * 1000) this.recent.delete(k);
    if (this.recent.has(key)) return true;
    this.recent.set(key, now);
    return false;
  }
  // Envia a todas las suscripciones; borra las caducadas (404/410).
  async send(message, opts = {}) {
    const subs = this.list();
    if (!subs.length) return { sent: 0 };
    const payload = JSON.stringify(message).slice(0, 3000);
    const vapid = this.keys();
    let sent = 0;
    await Promise.all(subs.map(async (sub) => {
      try {
        const body = encryptPayload(payload, sub.keys);
        const aud = new URL(sub.endpoint).origin;
        const r = await this.fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            authorization: `vapid t=${vapidJwt(aud, vapid, this.subject)}, k=${vapid.publicKey}`,
            'content-encoding': 'aes128gcm',
            'content-type': 'application/octet-stream',
            ttl: String(opts.ttl || 86400),
            urgency: opts.urgency || 'normal',
            ...(opts.topic ? { topic: opts.topic } : {}),
          },
          body,
        });
        if (r.status === 404 || r.status === 410) this.remove(sub.endpoint);
        else if (r.ok) sent++;
      } catch { /* push service caido: reintento en el siguiente aviso */ }
    }));
    return { sent };
  }
}

// Traduce mensajes MSP a avisos push (null si no aplica).
function pushForMsp(msg) {
  const m = msg && msg.method;
  const p = (msg && msg.params) || {};
  if (!m) return null;
  if (m === 'approval/request' || m === 'approval/requested') {
    const what = p.toolName || (p.subject && p.subject.kind) || '';
    const desc = (p.subject && (p.subject.command || p.subject.path)) || '';
    return {
      key: 'appr:' + (p.approvalId || ''), urgency: 'high',
      msg: { title: 'Aprobación requerida' + (what ? ' · ' + what : ''), body: String(desc || 'Muse necesita tu permiso').slice(0, 180), tag: 'appr-' + (p.approvalId || ''), sessionId: p.sessionId || null },
    };
  }
  if (m === 'userInput/request' || m === 'userInput/requested') {
    const q = (Array.isArray(p.questions) && p.questions[0]) || {};
    return {
      key: 'ui:' + (p.userInputId || ''), urgency: 'high',
      msg: { title: 'Muse pregunta', body: String(q.question || q.header || 'Responde para continuar').slice(0, 180), tag: 'ui-' + (p.userInputId || ''), sessionId: p.sessionId || null },
    };
  }
  if (m === 'turn/completed') {
    const turn = p.turn || {};
    const st = String(p.status || p.outcome || turn.status || '');
    const err = p.error || turn.error;
    const failed = !!err || /fail|error/i.test(st);
    if (/cancel|interrupt|abort/i.test(st)) return null; // lo detuvo el usuario
    return {
      key: 'turn:' + (p.turnId || turn.turnId || Date.now()), urgency: failed ? 'high' : 'normal',
      msg: {
        title: failed ? 'El turno de Muse falló' : 'Muse terminó',
        body: failed ? String((err && (err.message || err)) || 'Abre la sesión para ver el detalle').slice(0, 180) : 'El turno ha terminado',
        tag: 'turn-' + (p.sessionId || ''), sessionId: p.sessionId || null,
      },
    };
  }
  return null;
}

module.exports = { PushStore, encryptPayload, vapidJwt, generateVapid, loadOrCreateVapid, validEndpoint, validSubscription, pushForMsp, rawPublicKey, b64u, fromB64u };
