'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function pngSize(file) {
  const bytes = fs.readFileSync(path.join(root, file));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
test('Android launcher icon is supplied in all densities and as an adaptive icon', () => {
  const r = 'native/androidApp/src/main/res/';
  for (const [density, px] of [
    ['mdpi',48], ['hdpi',72], ['xhdpi',96],
    ['xxhdpi',144], ['xxxhdpi',192]
  ]) {
    assert.deepEqual(pngSize(r+'mipmap-'+density+'/ic_launcher.png'),[px,px]);
    assert.deepEqual(pngSize(r+'mipmap-'+density+'/ic_launcher_round.png'),[px,px]);
  }
  assert.deepEqual(pngSize(r+'drawable-nodpi/ic_launcher_foreground.png'),[432,432]);
  const adaptive = fs.readFileSync(path.join(root,r+'mipmap-anydpi-v26/ic_launcher.xml'),'utf8');
  assert.match(adaptive, /<adaptive-icon/);
  assert.match(adaptive, /ic_launcher_monochrome/);
  const app = fs.readFileSync(path.join(root,'native/androidApp/src/main/AndroidManifest.xml'),'utf8');
  assert.match(app,/android:icon="@mipmap\/ic_launcher"/);
  assert.match(app,/android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(app,/POST_NOTIFICATIONS/);
});

test('PWA uses the approved branded artwork for favicon, install and offline shell', () => {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/manifest.webmanifest'),'utf8'));
  assert.deepEqual(pngSize('public/icon-192.png'),[192,192]);
  assert.deepEqual(pngSize('public/icon-512.png'),[512,512]);
  assert.ok(manifest.icons.some(x=>x.src==='/icon-512.png' && x.purpose.includes('maskable')));
  assert.deepEqual(pngSize('public/apple-touch-icon.png'),[180,180]);
  assert.deepEqual(pngSize('public/muse-remote-wordmark.png'),[1040,256]);
  const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  assert.match(index,/rel="icon" href="\/icon-192.png"/);
  const sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
  assert.match(sw,/icon-192.png/);
  assert.match(sw,/icon-512.png/);
  assert.doesNotMatch(sw,/muse-remote-v22/);
});
