// Optional encrypted LAN listener; the loopback HTTP server remains unchanged.
// Never put bearer tokens in mDNS/TXT records or start LAN without a certificate.
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const ROOT = __dirname;
const LAN_PORT = Number(process.env.MUSE_REMOTE_LAN_PORT || 8788);

function isPrivatePeer(raw) {
  const address = String(raw || '').replace(/^::ffff:/, '');
  if (net.isIP(address) !== 4) return false; // explicitly IPv4-only listener
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254) ||
    a === 127;
}
function normalizeFingerprint(value) {
  const pin = String(value || '').replace(/[:\s]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error('invalid certificate SHA-256 fingerprint');
  return pin;
}
function pemOrPfxOptions(root = ROOT) {
  const pfxPath = process.env.MUSE_REMOTE_LAN_PFX || path.join(root, '.lan.pfx');
  const passPath = process.env.MUSE_REMOTE_LAN_PASS_FILE || path.join(root, '.lan.pass');
  const fingerprintPath = process.env.MUSE_REMOTE_LAN_FINGERPRINT || path.join(root, '.lan.fingerprint');
  const pfx = fs.readFileSync(pfxPath);
  const passphrase = process.env.MUSE_REMOTE_LAN_PFX_PASS || fs.readFileSync(passPath, 'utf8').trim();
  if (!passphrase) throw new Error('LAN PFX passphrase missing');
  const fingerprint = normalizeFingerprint(fs.readFileSync(fingerprintPath, 'utf8'));
  return { pfx, passphrase, fingerprint };
}
function startLan(handler, options = {}) {
  const enabled = options.enabled === undefined
    ? process.env.MUSE_REMOTE_LAN === '1' : options.enabled;
  if (!enabled) return null;
  const port = options.port || LAN_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid LAN port');
  const tls = options.tls || pemOrPfxOptions(options.root || ROOT);
  const fingerprint = normalizeFingerprint(tls.fingerprint);
  const listener = https.createServer({pfx: tls.pfx, passphrase: tls.passphrase}, (req, res) => {
    if (!isPrivatePeer(req.socket.remoteAddress)) {
      res.writeHead(403, {'content-type': 'text/plain', 'cache-control':'no-store'});
      res.end('LAN only');
      return;
    }
    // The native client only needs API endpoints; no PWA or static assets on LAN.
    if (!/^\/api\//.test(req.url || '')) {
      res.writeHead(404, {'content-type':'text/plain', 'cache-control':'no-store'});
      res.end('Not found');
      return;
    }
    handler(req, res);
  });
  listener.on('error', err => {
    console.error('[LAN HTTPS] ' + err.message);
  });
  let bonjour = null;
  listener.listen(port, '0.0.0.0', () => {
    console.log('[LAN HTTPS] https://<IP-local>:' + port + ' (solo subred privada)');
    console.log('[LAN HTTPS] SHA-256 del certificado: ' + fingerprint.toUpperCase());
    if (options.advertise !== false) {
      try {
        const { Bonjour } = require('bonjour-service');
        bonjour = new Bonjour(undefined, (e) => console.warn('[LAN mDNS] ' + e.message));
        bonjour.publish({
          name: 'Muse Remote ' + os.hostname(),
          type: 'museremote',
          port,
          protocol: 'tcp',
          disableIPv6: true,
          txt: { v: '1', tls: 'pinned', fp: fingerprint },
        });
      } catch (e) {
        console.warn('[LAN mDNS] Sin anuncio; conecta manualmente: ' + e.message);
      }
    }
  });
  return {
    listener,
    close() {
      if (bonjour) {
        try { bonjour.unpublishAll(); bonjour.destroy(); } catch {}
      }
      listener.close();
    },
  };
}
module.exports = { startLan, isPrivatePeer, normalizeFingerprint, pemOrPfxOptions };
