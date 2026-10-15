'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isPrivatePeer, normalizeFingerprint} = require('../lan');

test('LAN permits loopback and RFC1918 ranges only', () => {
  for (const addr of ['127.0.0.1', '::ffff:192.168.1.12', '10.7.4.3', '172.16.1.5', '172.31.255.253', '192.168.40.2']) {
    assert.equal(isPrivatePeer(addr), true, addr);
  }
  for (const addr of ['8.8.8.8', '100.85.12.34', '172.32.0.1', '192.0.2.3', '2001:db8::1', '::ffff:8.8.4.4', '']) {
    assert.equal(isPrivatePeer(addr), false, addr);
  }
});
test('pin must be full SHA-256 and is normalized', () => {
 const uppercase='AB'.repeat(32);
 assert.equal(normalizeFingerprint(uppercase), 'ab'.repeat(32));
 assert.equal(normalizeFingerprint('AB:'.repeat(31)+'AB'), 'ab'.repeat(32));
 for(const pin of ['', 'c0ffee', 'z'.repeat(64), 'ab'.repeat(31)]) assert.throws(()=>normalizeFingerprint(pin));
});
