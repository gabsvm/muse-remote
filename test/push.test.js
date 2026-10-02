// Web Push sin dependencias: cifrado RFC 8291, VAPID RFC 8292, validacion y
// endpoints. No requiere `muse serve`.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { encryptPayload, vapidJwt, generateVapid, validEndpoint, validSubscription, pushForMsp, PushStore, fromB64u, b64u } = require('../push.js');

// Lado del navegador: descifra aes128gcm (RFC 8291) con su clave privada.
function decrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(rs, 4096);
  assert.equal(plain[plain.length - 1], 2, 'delimitador de ultimo registro');
  return plain.subarray(0, plain.length - 1).toString();
}
function fakeSub() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } } };
}

test('cifrado aes128gcm descifrable por el navegador (RFC 8291)', () => {
  const { ua, auth, sub } = fakeSub();
  const body = encryptPayload('{"title":"hola ñ"}', sub.keys);
  assert.equal(decrypt(body, ua, auth), '{"title":"hola ñ"}');
  // Claves efimeras distintas en cada envio.
  assert.notDeepEqual(encryptPayload('x', sub.keys).subarray(21, 86), encryptPayload('x', sub.keys).subarray(21, 86));
  assert.throws(() => encryptPayload('x', { p256dh: 'AAAA', auth: b64u(auth) }), /p256dh/);
  assert.throws(() => encryptPayload('x'.repeat(5000), sub.keys), /grande/);
});

test('JWT VAPID ES256 verificable con la clave publica', () => {
  const v = generateVapid();
  assert.equal(fromB64u(v.publicKey).length, 65);
  const jwt = vapidJwt('https://fcm.googleapis.com', v, 'mailto:a@b.c', 1000);
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, 1000 + 12 * 3600);
  const pub = crypto.createPublicKey(crypto.createPrivateKey(v.privateKeyPem));
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test('endpoints: solo https publico (sin SSRF a la red local)', () => {
  assert.equal(validEndpoint('https://fcm.googleapis.com/fcm/send/x'), true);
  assert.equal(validEndpoint('https://web.push.apple.com/abc'), true);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.2/x', 'https://router.local/x', 'https://intranet/x', 'https://u:p@fcm.googleapis.com/x', 'nope']) {
    assert.equal(validEndpoint(bad), false, bad);
  }
  assert.equal(validSubscription(fakeSub().sub), true);
  assert.equal(validSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'x', auth: 'y' } }), false);
});

test('pushForMsp: aprobaciones, preguntas y fin de turno; detenido no avisa', () => {
  const a = pushForMsp({ method: 'approval/request', params: { approvalId: 'a1', toolName: 'shell', subject: { command: 'rm -rf build' }, sessionId: 's' } });
  assert.equal(a.urgency, 'high');
  assert.match(a.msg.title, /Aprobación requerida · shell/);
  assert.equal(a.msg.body, 'rm -rf build');
  assert.equal(a.msg.sessionId, 's');
  assert.match(pushForMsp({ method: 'userInput/requested', params: { userInputId: 'u', questions: [{ question: '¿Seguir?' }] } }).msg.body, /Seguir/);
  assert.match(pushForMsp({ method: 'turn/completed', params: { turnId: 't', status: 'completed' } }).msg.title, /terminó/);
  assert.match(pushForMsp({ method: 'turn/completed', params: { turnId: 't', error: { message: 'boom' } } }).msg.body, /boom/);
  assert.equal(pushForMsp({ method: 'turn/completed', params: { status: 'interrupted' } }), null);
  assert.equal(pushForMsp({ method: 'item/delta', params: {} }), null);
});

test('PushStore: envia cifrado con VAPID, deduplica y purga suscripciones caducadas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  const calls = [];
  let status = 201;
  const store = new PushStore({ subsFile: path.join(dir, 's.json'), vapidFile: path.join(dir, 'v.json'), fetch: async (url, o) => { calls.push({ url, o }); return { ok: status < 300, status }; } });
  const { ua, auth, sub } = fakeSub();
  assert.throws(() => store.add({ endpoint: 'http://x' }), /invalida/);
  store.add(sub);
  store.add(sub); // sin duplicados
  assert.equal(store.list().length, 1);
  const r = await store.send({ title: 'T' }, { urgency: 'high' });
  assert.equal(r.sent, 1);
  if (process.platform !== 'win32') {
    for (const f of ['v.json', 's.json']) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  }
  const h = calls[0].o.headers;
  assert.match(h.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(h['content-encoding'], 'aes128gcm');
  assert.equal(h.urgency, 'high');
  assert.equal(decrypt(calls[0].o.body, ua, auth), '{"title":"T"}');
  assert.equal(store.seen('k'), false);
  assert.equal(store.seen('k'), true);
  status = 410;
  await store.send({ title: 'T' });
  assert.equal(store.list().length, 0, 'suscripcion caducada purgada');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 's.json'), 'utf8')), []);
});

// Endpoints HTTP (requieren token).
const { server, HOST, loadOrCreateToken } = require('../server.js');
let base;
before(async () => { await new Promise((r) => server.listen(0, HOST, r)); base = `http://${HOST}:${server.address().port}`; });
after(() => new Promise((r) => server.close(r)));

test('endpoints push: auth obligatoria, clave publica y validacion', async () => {
  assert.equal((await fetch(base + '/api/push/key')).status, 401);
  const H = { authorization: 'Bearer ' + loadOrCreateToken(), 'content-type': 'application/json' };
  const k = await (await fetch(base + '/api/push/key', { headers: H })).json();
  assert.equal(fromB64u(k.publicKey).length, 65);
  const bad = await fetch(base + '/api/push/subscribe', { method: 'POST', headers: H, body: JSON.stringify({ subscription: { endpoint: 'https://127.0.0.1/x', keys: {} } }) });
  assert.equal(bad.status, 400);
  const noauth = await fetch(base + '/api/push/subscribe', { method: 'POST', body: '{}' });
  assert.equal(noauth.status, 401);
  const un = await fetch(base + '/api/push/unsubscribe', { method: 'POST', headers: H, body: JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/none' } }) });
  assert.equal(un.status, 200);
});
