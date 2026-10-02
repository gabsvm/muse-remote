// Regresion de endurecimiento: (1) fail-closed META_API_KEY, (2) Bearer-only
// en /api/events, (3) limites cuerpo/imagen, (4) allowlist MSP, (5) static
// hardening, (6) CSP+headers. No requiere `muse serve` (sin msp.start()).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  server, HOST, loadOrCreateToken,
  ALLOWED_METHODS, RPC_BODY_LIMIT, MAX_IMAGE_BASE64_CHARS, CSP,
  META_ENV_KEY, assertNoMetaApiKey, childEnvWithoutMetaKey,
} = require('../server.js');

let base;
let token;
before(async () => {
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  base = `http://${HOST}:${server.address().port}`;
  token = loadOrCreateToken();
});
after(() => new Promise((resolve) => server.close(resolve)));

const H = (t) => ({ authorization: 'Bearer ' + (t || token) });
async function postRpc(t, body) {
  const r = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { ...H(t), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

// (1) fail-closed contra META_API_KEY + hijo sin herencia.
test('(1) fail-closed: META_API_KEY definida lanza', () => {
  assert.equal(META_ENV_KEY, 'META_API_KEY');
  assert.throws(() => assertNoMetaApiKey({ META_API_KEY: 'sk-x' }), /fail-closed/);
  assert.throws(() => assertNoMetaApiKey({ META_API_KEY: '  sk-x  ' }), /fail-closed/);
  assert.doesNotThrow(() => assertNoMetaApiKey({}));
  assert.doesNotThrow(() => assertNoMetaApiKey({ META_API_KEY: '' }));
  assert.doesNotThrow(() => assertNoMetaApiKey({ META_API_KEY: '   ' }));
});

test('(1) hijo saneado: childEnvWithoutMetaKey elimina la clave', () => {
  const env = childEnvWithoutMetaKey({ META_API_KEY: 'sk-x', KEEP: '1' });
  assert.equal(env.META_API_KEY, undefined);
  assert.ok(!('META_API_KEY' in env));
  assert.equal(env.KEEP, '1');
});

test('(1) spawn del hijo usa entorno saneado (sin herencia)', () => {
  const src = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.match(src, /env:\s*childEnvWithoutMetaKey\(\)/);
  assert.ok(!/spawn\([^)]*process\.env[^)]*\)/.test(src), 'spawn no debe pasar process.env directo');
});

// (2) streaming con fetch: solo Authorization: Bearer, query se ignora.
test('(2) events ignora ?token= sin cabecera (401)', async () => {
  const r = await fetch(`${base}/api/events?sessionId=s1&token=${token}`);
  assert.equal(r.status, 401);
  await r.arrayBuffer().catch(() => {});
});

test('(2) events con Bearer llega a la logica (400 sin sessionId / 503 sin msp)', async () => {
  const noSid = await fetch(base + '/api/events', { headers: H() });
  assert.equal(noSid.status, 400);
  await noSid.arrayBuffer().catch(() => {});
  const ok = await fetch(base + '/api/events?sessionId=s1', { headers: H() });
  // msp no arrancado en este fichero: 503 prueba que el Bearer fue aceptado.
  assert.equal(ok.status, 503);
  await ok.arrayBuffer().catch(() => {});
});

// (3) limites explicitos servidor.
test('(3) constantes de limite explicitas y coherentes', () => {
  assert.equal(RPC_BODY_LIMIT, 5 * 1024 * 1024);
  assert.equal(MAX_IMAGE_BASE64_CHARS, 4 * 1024 * 1024);
  assert.ok(MAX_IMAGE_BASE64_CHARS < RPC_BODY_LIMIT);
});

test('(3) imagen gigante por RPC se rechaza con 413 sin tocar MSP', async () => {
  const big = 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1);
  const { status, json } = await postRpc(token, {
    method: 'turn/start',
    params: { sessionId: 's', commandId: 'c', input: [{ type: 'image', base64Data: big, mediaType: 'image/jpeg' }] },
  });
  assert.equal(status, 413);
  assert.equal(json.error, 'image too large');
});

test('(3) cuerpo mayor que 5 MiB responde 413', async () => {
  const pad = 'x'.repeat(RPC_BODY_LIMIT + 1024);
  const r = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { ...H(), 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'model/list', params: {}, pad }),
  });
  assert.equal(r.status, 413);
  const j = await r.json();
  assert.equal(j.error, 'body too large');
});

// (4) allowlist en lugar de denylist.
test('(4) allowlist contiene los metodos de la app y excluye initialize', () => {
  for (const m of [
    'session/list', 'session/start', 'session/resume', 'session/read',
    'session/fork', 'session/compact', 'session/setModel',
    'session/setReasoningEffort', 'session/setApprovalMode', 'session/userShell',
    'turn/start', 'turn/steer', 'turn/unqueue', 'turn/interrupt',
    'view/page', 'view/subscribe', 'model/list', 'skill/list', 'usage/read',
    'item/readOutput', 'task/background', 'task/stop',
    'subagent/sendMessage', 'subagent/followupTask', 'subagent/stop',
    'approval/decide', 'approval/listPending', 'userInput/answer',
  ]) assert.ok(ALLOWED_METHODS.has(m), 'falta ' + m);
  assert.ok(!ALLOWED_METHODS.has('initialize'));
  assert.ok(!ALLOWED_METHODS.has('initialized'));
});

test('(4) metodo fuera de la allowlist -> 403', async () => {
  for (const m of ['initialize', 'initialized', 'session/delete', 'workflow/cancel', 'turn/cancel']) {
    const { status } = await postRpc(token, { method: m, params: {} });
    assert.equal(status, 403, m);
  }
});

test('(4) metodo permitido pasa la allowlist (503 = llego a MSP caido)', async () => {
  const { status } = await postRpc(token, { method: 'model/list', params: {} });
  assert.equal(status, 503);
});

// (5) static hardening.
test('(5) decodeURIComponent invalido -> 400 sin tumbar el servidor', async () => {
  const r = await fetch(base + '/%E0%A4%A');
  assert.equal(r.status, 400);
  await r.arrayBuffer().catch(() => {});
  const h = await fetch(base + '/api/health');
  assert.equal(h.status, 200);
  await h.arrayBuffer().catch(() => {});
});

test('(5) traversal no fuga server.js', async () => {
  for (const p of ['/..%2Fserver.js', '/%2e%2e%2fserver.js', '/../server.js']) {
    const r = await fetch(base + p);
    assert.ok(r.status === 403 || r.status === 404, p + ' -> ' + r.status);
    const t = await r.text().catch(() => '');
    assert.ok(!t.includes('MspHost') && !t.includes('muse serve'), 'fuga en ' + p);
  }
});

// (6) CSP y headers en estaticos, API y errores.
test('(6) headers de seguridad + CSP compatible PWA', async () => {
  for (const p of ['/', '/api/health']) {
    const r = await fetch(base + p, p.startsWith('/api') ? undefined : undefined);
    assert.equal(r.status, 200, p);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /connect-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(r.headers.get('referrer-policy') || '', /same-origin/);
    await r.arrayBuffer().catch(() => {});
  }
  assert.match(CSP, /style-src 'self' 'unsafe-inline'/); // inline styles de la PWA
});

// (7) robustez del puente y estaticos.
test('(7) hijo muerto: escribir en su stdin no tumba el proceso (EPIPE manejado)', () => {
  const src = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.match(src, /child\.stdin\.on\('error'/);
});

test('(7) estaticos con no-cache (la PWA nunca queda obsoleta) y theme.js servido', async () => {
  for (const p of ['/', '/app.js', '/theme.js', '/sw.js']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
    await r.arrayBuffer();
  }
});

test('(7) metodo no soportado: 405 con Allow', async () => {
  const r = await fetch(base + '/', { method: 'PUT' });
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow') || '', /GET/);
  await r.arrayBuffer();
});

test('(7) index.html sin scripts inline (compatible con CSP script-src self)', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.ok(scripts.length >= 2);
  for (const s of scripts) assert.match(s, /\bsrc="\//, 'script inline: ' + s);
  assert.ok(!/\son[a-z]+="/i.test(html), 'handlers inline en index.html');
});
