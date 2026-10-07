// Script `npm run tunnel`: argumentos, comando de cloudflared y deteccion de URL.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, cloudflaredArgs, findTunnelUrl, hintFor } = require('../scripts/tunnel.js');

test('quick tunnel protegido: --allowed-mail por cada correo', () => {
  const o = parseArgs(['--mail', 'a@b.com', '--mail', '*@empresa.com'], {});
  assert.deepEqual(o.mails, ['a@b.com', '*@empresa.com']);
  assert.deepEqual(cloudflaredArgs(o), ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8787', '--allowed-mail', 'a@b.com', '--allowed-mail', '*@empresa.com']);
});

test('correos y puerto por entorno, sin duplicados', () => {
  const o = parseArgs(['--mail', 'a@b.com'], { MUSE_REMOTE_ALLOWED_MAIL: 'a@b.com, c@d.org', MUSE_REMOTE_PORT: '9000' });
  assert.deepEqual(o.mails, ['a@b.com', 'c@d.org']);
  assert.equal(o.port, 9000);
  assert.ok(cloudflaredArgs(o).includes('http://127.0.0.1:9000'));
});

test('sin correo exige --public o --name (no expone sin querer)', () => {
  assert.throws(() => parseArgs([], {}), /--mail/);
  assert.equal(parseArgs(['--public'], {}).public, true);
  const n = parseArgs(['--name', 'muse', '--hostname', 'muse.ej.com'], {});
  assert.deepEqual(cloudflaredArgs(n), ['tunnel', '--no-autoupdate', 'run', '--url', 'http://127.0.0.1:8787', 'muse']);
});

test('valida correos, puerto y opciones', () => {
  assert.throws(() => parseArgs(['--mail', 'no-es-correo'], {}), /no valido/);
  assert.throws(() => parseArgs(['--mail'], {}), /falta el valor/);
  assert.throws(() => parseArgs(['--public', '--port', '0'], {}), /puerto/);
  assert.throws(() => parseArgs(['--loquesea'], {}), /desconocida/);
});

test('detecta la URL del quick tunnel y da pistas de errores', () => {
  const log = '2026-10-03T09:56:40Z INF |  https://event-shades-unions-street.trycloudflare.com  |';
  assert.equal(findTunnelUrl(log), 'https://event-shades-unions-street.trycloudflare.com');
  assert.equal(findTunnelUrl('nada'), null);
  assert.match(hintFor('flag provided but not defined: -allowed-mail'), /actualiza/);
  assert.match(hintFor('Cannot determine default origin certificate path'), /tunnel login/);
  assert.equal(hintFor('INF todo bien'), null);
});
