// Punto (3): el limite historico de 256 KiB rechazaba las imagenes
// JPEG/base64 del cliente. Regresion + test REAL de envio de imagen
// (session/start + turn/start con parte `image` contra `muse serve`).
'use strict';
const { test, before, after } = require('node:test');
// The real-host integration suite uses an ephemeral, test-only bearer token.
process.env.MUSE_REMOTE_TOKEN = 'muse-remote-integration-test-local-only-token';
const assert = require('node:assert/strict');
const { server, msp, HOST, loadOrCreateToken, uuidv7, RPC_BODY_LIMIT, MAX_IMAGE_BASE64_CHARS } = require('../server.js');

// JPEG minimo real de 1x1 (SOI..EOI valido) para que MSP lo acepte.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////wgARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AK//Z';

let base;
let token;
before(async () => {
  msp.start();
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  base = `http://${HOST}:${server.address().port}`;
  token = loadOrCreateToken();
  const t0 = Date.now();
  while (!msp.ready) {
    if (Date.now() - t0 > 45000) throw new Error('msp host no listo');
    await new Promise((r) => setTimeout(r, 500));
  }
});
after(() => {
  msp.shutdown();
  return new Promise((resolve) => server.close(resolve));
});

async function rpc(method, params) {
  const r = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  return { status: r.status, json: await r.json() };
}

test('limites coherentes: 5 MiB cuerpo, 4 MiB imagen, JPEG cliente cabe', () => {
  assert.equal(RPC_BODY_LIMIT, 5 * 1024 * 1024);
  assert.equal(MAX_IMAGE_BASE64_CHARS, 4 * 1024 * 1024);
  assert.ok(TINY_JPEG_B64.length < 10 * 1024, 'el JPEG de prueba debe ser diminuto');
  // Peor caso realista del cliente (1568px q0.85, <1 MiB) cabe con margen.
  assert.ok(1024 * 1024 < MAX_IMAGE_BASE64_CHARS);
});

test('envio real de imagen: turn/start con texto+image vuelve ack', async () => {
  const started = await rpc('session/start', { commandId: uuidv7() });
  assert.equal(started.status, 200, JSON.stringify(started.json).slice(0, 300));
  const sid = started.json.result.session.sessionId;
  const { status, json } = await rpc('turn/start', {
    commandId: uuidv7(),
    sessionId: sid,
    input: [
      { type: 'text', text: 'describe esta imagen en una palabra' },
      { type: 'image', base64Data: TINY_JPEG_B64, mediaType: 'image/jpeg', width: 1, height: 1 },
    ],
    ifBusy: 'queue',
  });
  assert.equal(status, 200, JSON.stringify(json).slice(0, 500));
  assert.equal(json.ok, true);
  // Detener el turno para no dejar inferencia corriendo tras el test.
  try { await rpc('turn/interrupt', { commandId: uuidv7(), sessionId: sid }); } catch { /* best effort */ }
}, { timeout: 180000 });

test('cuerpo de ~1 MiB (antes rechazado por 256 KiB) ya no es 413', async () => {
  const started = await rpc('session/start', { commandId: uuidv7() });
  assert.equal(started.status, 200);
  const sid = started.json.result.session.sessionId;
  const big = 'A'.repeat(1024 * 1024);
  const { status } = await rpc('turn/start', {
    commandId: uuidv7(),
    sessionId: sid,
    input: [{ type: 'image', base64Data: big, mediaType: 'image/jpeg', width: 1, height: 1 }],
    ifBusy: 'queue',
  });
  // 413 seria la regresion; 200/502 significa que paso el gate HTTP.
  assert.ok(status === 200 || status === 502, 'status=' + status);
  try { await rpc('turn/interrupt', { commandId: uuidv7(), sessionId: sid }); } catch { /* noop */ }
}, { timeout: 180000 });
