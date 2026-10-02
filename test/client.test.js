// Tests del codigo REAL servido al navegador (parseo SSE y formato de sesiones).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.document = { addEventListener() {}, getElementById: () => null };
global.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
const { parseFrame, sessMeta, fmtDate, fmtRel, isEmptySession, sortSessions, sessTitle, turnos, usageLine, loadHidden, saveHidden, isHidden, CLIENT_MAX_IMAGE_DIM, CLIENT_MAX_IMAGE_BASE64_CHARS, CLIENT_MAX_RPC_BYTES, imageBase64TooLarge, streamEvents, filterSessions, splitFences, parseInline, friendlyError, wsName } = require('../public/app.js');

test('parseFrame: evento subscribed simple', () => {
  assert.deepEqual(parseFrame('event: subscribed\ndata: {"a":1}'), { type: 'subscribed', data: '{"a":1}' });
});

test('parseFrame: ignora comentarios y frames sin tipo', () => {
  assert.equal(parseFrame(': ping'), null);
  assert.equal(parseFrame('data: x'), null);
  assert.equal(parseFrame(''), null);
});

test('parseFrame: une multi-data y respeta JSON con dos puntos', () => {
  const f = parseFrame('event: item/delta\ndata: {"d":"a:b"}\ndata: {"e":2}');
  assert.equal(f.type, 'item/delta');
  assert.equal(f.data, '{"d":"a:b"}\n{"e":2}');
});

test('parseFrame: tolera \\r y espacios tras el prefijo', () => {
  assert.deepEqual(parseFrame('event: ping\r\ndata:  {}'), { type: 'ping', data: ' {}' });
});

test('parseFrame: frame de error del servidor', () => {
  const f = parseFrame('event: error\ndata: {"error":"x"}');
  assert.deepEqual(f, { type: 'error', data: '{"error":"x"}' });
});

test('sessMeta: compone estado, modelo, turnos y fecha', () => {
  const m = sessMeta({ status: 'idle', modelId: 'm', turnCount: 3, updatedAt: '2026-09-22T10:00:00.000Z', workspaceRoot: 'C:\\Dev\\x', sessionId: 's' });
  assert.match(m, /idle/);
  assert.match(m, /3 turnos/);
  assert.match(m, /x/);
});

test('fmtDate: vacio e invalido pasan sin romper', () => {
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate(null), '');
  assert.ok(fmtDate('no-fecha').length > 0);
});

test('sortSessions: actividad primero, vacias al final', () => {
  const a = { sessionId: 'a', turnCount: 0, updatedAt: '2026-09-22T12:00:00Z' };
  const b = { sessionId: 'b', turnCount: 3, firstUserPrompt: 'hola', updatedAt: '2026-09-21T10:00:00Z' };
  const c = { sessionId: 'c', turnCount: 1, firstUserPrompt: 'x', updatedAt: '2026-09-22T11:00:00Z' };
  const out = sortSessions([a, b, c]).map((s) => s.sessionId);
  assert.deepEqual(out, ['c', 'b', 'a']);
});

test('sessTitle limpia marcador de imagen y turnos pluraliza', () => {
  assert.equal(sessTitle({ firstUserPrompt: 'Mira esto[Image #1]' }), 'Mira esto');
  assert.match(sessTitle({}), /^Sesión /);
  assert.equal(turnos(1), '1 turno');
  assert.equal(turnos(3), '3 turnos');
  assert.equal(turnos(0), '0 turnos');
});

test('isEmptySession y fmtRel', () => {
  assert.equal(isEmptySession({ turnCount: 0 }), true);
  assert.equal(isEmptySession({ turnCount: 0, firstUserPrompt: 'hola' }), false);
  assert.equal(isEmptySession({ turnCount: 5 }), false);
  assert.equal(fmtRel(''), '');
  assert.match(fmtRel(new Date(Date.now() - 90 * 1000).toISOString()), /hace 1 min/);
});

test('usageLine: usado, restante y reseteo', () => {
  assert.equal(usageLine(null, 'Semanal'), null);
  assert.equal(usageLine({}, 'Semanal'), null);
  const t = usageLine({ usedPercent: 65, resetsAtMs: 1790553600000 }, 'Semanal');
  assert.match(t, /Semanal 65%/);
  assert.match(t, /queda 35%/);
  assert.match(t, /se libera/);
  const over = usageLine({ usedPercent: 112 }, 'Ventana');
  assert.match(over, /queda -12%/);
});

test('limites de imagen del cliente explicitos y coherentes con el servidor', () => {
  assert.equal(CLIENT_MAX_IMAGE_DIM, 1568);
  assert.equal(CLIENT_MAX_IMAGE_BASE64_CHARS, 4 * 1024 * 1024);
  assert.equal(CLIENT_MAX_RPC_BYTES, 5 * 1024 * 1024);
  assert.equal(imageBase64TooLarge('a'.repeat(100)), false);
  assert.equal(imageBase64TooLarge('a'.repeat(CLIENT_MAX_IMAGE_BASE64_CHARS + 1)), true);
  assert.equal(imageBase64TooLarge(null), false);
});

test('streaming usa Bearer en cabecera, nunca token en query', async () => {
  const seen = {};
  global.fetch = async (url, opts) => {
    seen.url = String(url);
    seen.headers = opts && opts.headers;
    return { ok: false, status: 401, headers: { get: () => '' }, body: { cancel: async () => {} } };
  };
  let failed = null;
  const h = streamEvents('/api/events?sessionId=s', 1, { open: () => {}, event: () => {}, failure: (r) => { failed = r; } }, { authorization: 'Bearer tok' });
  await new Promise((r) => setTimeout(r, 50));
  h.close();
  assert.ok(!seen.url.includes('token='), 'token en query: ' + seen.url);
  assert.equal(seen.headers && seen.headers.authorization, 'Bearer tok');
  delete global.fetch;
  assert.ok(failed === null || typeof failed === 'string');
});

test('connectEvents no mete el token en la URL (fuente)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  assert.ok(!/URLSearchParams\(\{\s*sessionId:[^}]*token/.test(src), 'query con token');
  assert.ok(/authorization:\s*'Bearer '\s*\+\s*state\.token/.test(src), 'falta Bearer en streaming');
});

test('ocultas: guardar, leer y comprobar', () => {
  assert.deepEqual(loadHidden(), []);
  assert.equal(isHidden('abc'), false);
  saveHidden(['abc', 'def']);
  assert.deepEqual(loadHidden(), ['abc', 'def']);
  assert.equal(isHidden('abc'), true);
  assert.equal(isHidden('zzz'), false);
  saveHidden([]);
  assert.deepEqual(loadHidden(), []);
});

test('filterSessions: pestañas, ocultas y busqueda sin red', () => {
  const list = [
    { sessionId: 'a', turnCount: 2, firstUserPrompt: 'Arreglar login', workspaceRoot: 'C:\\Dev\\web', updatedAt: '2026-09-22T12:00:00Z' },
    { sessionId: 'b', turnCount: 1, firstUserPrompt: 'Refactor API', updatedAt: '2026-09-22T11:00:00Z' },
    { sessionId: 'c', turnCount: 0 },
  ];
  const all = filterSessions(list, { tab: 'chats' });
  assert.deepEqual(all.rows.map((s) => s.sessionId), ['a', 'b']);
  assert.equal(all.nChats, 2);
  assert.equal(all.nEmpty, 1);
  assert.deepEqual(filterSessions(list, { tab: 'empty' }).rows.map((s) => s.sessionId), ['c']);
  const hid = filterSessions(list, { tab: 'chats', hidden: ['a'] });
  assert.deepEqual(hid.rows.map((s) => s.sessionId), ['b']);
  assert.equal(hid.nHidden, 1);
  assert.equal(filterSessions(list, { tab: 'chats', hidden: ['a'], showHidden: true }).rows.length, 2);
  assert.deepEqual(filterSessions(list, { tab: 'chats', query: 'WEB' }).rows.map((s) => s.sessionId), ['a']);
  assert.equal(filterSessions(list, { tab: 'chats', query: 'zzz' }).rows.length, 0);
});

test('splitFences: texto y codigo, cercado sin cerrar en streaming', () => {
  assert.deepEqual(splitFences('hola'), [{ type: 'text', text: 'hola' }]);
  const s = splitFences('antes\n```js\nconst a = 1;\n```\ndespues');
  assert.equal(s.length, 3);
  assert.deepEqual(s[1], { type: 'code', lang: 'js', text: 'const a = 1;' });
  assert.equal(s[2].text, '\ndespues');
  const open = splitFences('x\n```\nparcial');
  assert.deepEqual(open[1], { type: 'code', lang: '', text: 'parcial' });
  assert.deepEqual(splitFences(''), []);
});

test('parseInline: codigo, negrita y enlaces; nunca HTML', () => {
  const t = parseInline('usa `npm test` y **ya** ver https://example.com/a.');
  assert.deepEqual(t.map((x) => x.t), ['text', 'code', 'text', 'bold', 'text', 'link', 'text']);
  assert.equal(t[1].v, 'npm test');
  assert.equal(t[3].v, 'ya');
  assert.equal(t[5].v, 'https://example.com/a');
  assert.equal(t[6].v, '.');
  assert.deepEqual(parseInline('<b>x</b>'), [{ t: 'text', v: '<b>x</b>' }]);
  assert.deepEqual(parseInline('javascript:alert(1)'), [{ t: 'text', v: 'javascript:alert(1)' }]);
});

test('friendlyError y wsName', () => {
  assert.match(friendlyError('msp host not ready'), /arrancando/);
  assert.match(friendlyError('msp timeout: session/list'), /tardó/);
  assert.equal(friendlyError('otro'), 'otro');
  assert.equal(wsName('C:\\Dev\\proyecto'), 'proyecto');
  assert.equal(wsName('/home/u/repo/'), 'repo');
  assert.equal(wsName(''), '');
});
