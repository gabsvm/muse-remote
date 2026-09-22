// Pruebas HTTP del backend: bind loopback, auth por token, allowlist MSP.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, msp, HOST, loadOrCreateToken } = require('../server.js');

let base;
before(async () => {
  msp.start();
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  base = `http://${HOST}:${server.address().port}`;
  const t0 = Date.now();
  while (!msp.ready) {
    if (Date.now() - t0 > 45000) throw new Error('msp host no listo');
    await new Promise((r) => setTimeout(r, 500));
  }
});
after(() => {
  msp.shutdown(); // soltar el hijo `muse serve` para que el runner termine
  return new Promise((resolve) => server.close(resolve));
});

async function rpc(token, method, params) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(base + '/api/rpc', {
    method: 'POST', headers, body: JSON.stringify({ method, params }),
  });
  return { status: r.status, json: await r.json() };
}

test('health publica estado MSP sin exigir token', async () => {
  const r = await fetch(base + '/api/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.mspReady, true);
});

test('rpc sin token se rechaza (401)', async () => {
  const { status } = await rpc(null, 'model/list', {});
  assert.equal(status, 401);
});

test('initialize/initialized los gestiona el puente (403)', async () => {
  const token = loadOrCreateToken();
  const { status } = await rpc(token, 'initialize', {});
  assert.equal(status, 403);
});

test('model/list via backend autenticado', async () => {
  const token = loadOrCreateToken();
  const { status, json } = await rpc(token, 'model/list', {});
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.result.models.length > 0);
});

test('events exige sessionId (400)', async () => {
  const token = loadOrCreateToken();
  const r = await fetch(base + '/api/events', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(r.status, 400);
});

test('view/subscribe sin sidecar propaga error (dispara modo poll)', async () => {
  const token = loadOrCreateToken();
  const { status, json } = await rpc(token, 'view/subscribe', { sessionId: '00000000-0000-7000-8000-000000000002' });
  assert.equal(status, 502);
  assert.equal(json.ok, false);
  assert.match(json.error || '', /session/i);
});

test('events abre SSE y emite subscribed (ruta que usa la PWA)', async () => {
  const token = loadOrCreateToken();
  const started = await rpc(token, 'session/start', { commandId: '00000000-0000-7000-8000-000000000001' });
  assert.equal(started.status, 200);
  const sid = started.json.result.session.sessionId;
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`${base}/api/events?sessionId=${sid}&token=${token}`, { signal: ctrl.signal });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
    let buf = '';
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString();
      if (buf.includes('event: subscribed')) break;
    }
    assert.ok(buf.includes('event: subscribed'), 'sin evento subscribed');
  } finally {
    clearTimeout(kill);
    ctrl.abort();
  }
}, { timeout: 60000 });
