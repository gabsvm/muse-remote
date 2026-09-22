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
const { parseFrame, sessMeta, fmtDate, fmtRel, isEmptySession, sortSessions, sessTitle, turnos, usageLine, loadHidden, saveHidden, isHidden } = require('../public/app.js');

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
