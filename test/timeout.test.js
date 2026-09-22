// Regresion: `session/list` admite respuestas posteriores a 90 s (hasta
// 180 s) sin cambiar el timeout global de 90 s del resto de metodos.
// Usa timers falsos: no espera tiempo real.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  msp, timeoutForMethod, DEFAULT_MSP_TIMEOUT, SESSION_LIST_TIMEOUT, METHOD_TIMEOUTS,
} = require('../server.js');

test('mapeo de timeouts: solo session/list tiene 180 s', () => {
  assert.equal(DEFAULT_MSP_TIMEOUT, 90000);
  assert.equal(SESSION_LIST_TIMEOUT, 180000);
  assert.deepEqual({ ...METHOD_TIMEOUTS }, { 'session/list': 180000 });
  assert.equal(timeoutForMethod('session/list'), 180000);
  for (const m of ['model/list', 'session/start', 'turn/start', 'view/page', 'no/existe']) {
    assert.equal(timeoutForMethod(m), 90000, m);
  }
});

test('session/list sobrevive a 90 s; el resto expira a 90 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prevReady = msp.ready;
  const prevChild = msp.child;
  msp.ready = true;
  msp.child = { stdin: { write() {} } }; // traga frames, nunca responde
  try {
    let slowState = 'pending';
    let fastErr = null;
    const slow = msp.request('session/list', { limit: 2 })
      .then(() => { slowState = 'resolved'; }, (e) => { slowState = e; });
    const fast = msp.request('model/list', {})
      .then(() => {}, (e) => { fastErr = e; });
    const pump = () => new Promise((r) => setImmediate(r));

    t.mock.timers.tick(90000);
    await pump();
    assert.match(String((fastErr && fastErr.message) || fastErr), /msp timeout: model\/list/);
    assert.equal(slowState, 'pending', 'session/list no debe expirar a 90 s');

    t.mock.timers.tick(89999);
    await pump();
    assert.equal(slowState, 'pending', 'session/list no debe expirar antes de 180 s');

    t.mock.timers.tick(1);
    await pump();
    assert.match(String((slowState && slowState.message) || slowState), /msp timeout: session\/list/);
    await slow;
    await fast;
  } finally {
    t.mock.timers.reset();
    msp.ready = prevReady;
    msp.child = prevChild;
    for (const [, p] of msp.pending) { try { clearTimeout(p.timer); } catch {} }
    msp.pending.clear();
  }
});
