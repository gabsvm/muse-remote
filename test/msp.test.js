// Validacion real contra `muse serve` (protocolo MSP oficial por stdio).
// Requiere el CLI autenticado; no usa API keys.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { msp, uuidv7 } = require('../server.js');

after(() => msp.shutdown()); // soltar el hijo `muse serve` para que el runner termine

test('uuidv7 tiene formato y version correctos', () => {
  const id = uuidv7();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

async function ready(timeoutMs = 45000) {
  msp.start();
  const t0 = Date.now();
  while (!msp.ready) {
    if (Date.now() - t0 > timeoutMs) throw new Error('msp host no listo a tiempo');
    await new Promise((r) => setTimeout(r, 500));
  }
}

test('handshake MSP: initialize responde con fingerprint estable', async () => {
  await ready();
  assert.ok(msp.serverInfo, 'sin serverInfo');
  assert.equal(msp.serverInfo.schema.fingerprint, 'sha256:7469c9e352e67def4a59df7e439984d7194fa351e1c8b7abb34060fd977ced81');
  assert.equal(msp.serverInfo.sessionDurability, 'durable');
});

test('model/list devuelve catalogo del provider (sin API key)', async () => {
  await ready();
  const res = await msp.request('model/list', {});
  assert.ok(Array.isArray(res.models) && res.models.length > 0, 'catalogo vacio');
  assert.equal(res.providerId, 'meta');
});

test('session/list pagina sesiones reales', async () => {
  await ready();
  const res = await msp.request('session/list', { limit: 2 });
  assert.ok(Array.isArray(res.sessions), 'sin array de sesiones');
}, { timeout: 120000 });

test('model/list con sessionId devuelve catalogo (selector de la UI)', async () => {
  await ready();
  // Sesion propia recien creada (las de session/list pueden estar en uso en otro host).
  const started = await msp.request('session/start', { commandId: uuidv7() });
  const sid = started.session.sessionId;
  const res = await msp.request('model/list', { sessionId: sid });
  assert.ok(Array.isArray(res.models) && res.models.length > 0, 'catalogo vacio con sessionId');
}, { timeout: 180000 });

test('session/start con workspaceRoot lo registra (herramientas de archivos)', async () => {
  await ready();
  const started = await msp.request('session/start', { commandId: uuidv7(), workspaceRoot: 'C:\\Dev' });
  assert.equal(started.session.workspaceRoot, 'C:\\Dev');
}, { timeout: 120000 });

test('lote permitido: approvalMode, skills, usage, shell, page (sin modelo)', async () => {
  await ready();
  const started = await msp.request('session/start', { commandId: uuidv7(), workspaceRoot: 'C:\\Dev' });
  const sid = started.session.sessionId;
  const am = await msp.request('session/setApprovalMode', { commandId: uuidv7(), sessionId: sid, mode: 'allowAll' });
  assert.equal(am.status, 'accepted');
  const back = await msp.request('session/setApprovalMode', { commandId: uuidv7(), sessionId: sid, mode: 'onRequest' });
  assert.equal(back.status, 'accepted');
  const sk = await msp.request('skill/list', { sessionId: sid });
  assert.ok(Array.isArray(sk.skills) && sk.skills.length > 0, 'sin skills');
  assert.ok(sk.skills[0].selector, 'skill sin selector');
  const us = await msp.request('usage/read', {});
  assert.ok(us && (us.usage === undefined || us.usage.window), 'forma usage inesperada');
  const sh = await msp.request('session/userShell', { commandId: uuidv7(), sessionId: sid, commandText: 'echo ok' });
  assert.equal(sh.status, 'accepted');
  const pg = await msp.request('view/page', { sessionId: sid, limit: 5 });
  assert.ok(Array.isArray(pg.events), 'page sin eventos');
  // Fork de sesion vacia se rechaza (boundary); la UI muestra ese error tal cual.
  await assert.rejects(
    msp.request('session/fork', { commandId: uuidv7(), sessionId: sid }),
    (e) => e.code === -32023,
  );
}, { timeout: 180000 });

test('session/start+resume+read roundtrip en este host (abrir sesion de la UI)', async () => {
  await ready();
  const started = await msp.request('session/start', { commandId: uuidv7() });
  const sid = started.session.sessionId;
  const resumed = await msp.request('session/resume', { commandId: uuidv7(), sessionId: sid });
  assert.equal(resumed.session.sessionId, sid);
  // El historial trae Items directos (no eventos view): asi lo consume la UI.
  assert.ok(Array.isArray(resumed.history.items), 'history.items no es array');
  const read = await msp.request('session/read', { sessionId: sid });
  assert.equal(read.session.sessionId, sid);
}, { timeout: 180000 });
