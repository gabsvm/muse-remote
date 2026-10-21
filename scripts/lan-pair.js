// Show the one-time local pairing QR on the trusted PC terminal.
// The QR includes the bearer token; do not post a screenshot or share it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
const port = process.env.MUSE_REMOTE_LAN_PORT || '8788';
const pin = fs.readFileSync(path.join(root, '.lan.fingerprint'), 'utf8').trim().toLowerCase();
const token = process.env.MUSE_REMOTE_TOKEN || fs.readFileSync(path.join(root, '.token'), 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(pin) || token.length < 16) throw new Error('Inicia setup-lan.ps1 y server.js antes de emparejar');
const ips = Object.values(os.networkInterfaces()).flat().filter((n) =>
  n && n.family === 'IPv4' && !n.internal &&
  (/^10\./.test(n.address) || /^192\.168\./.test(n.address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(n.address)))
  .map(n => n.address);
if (!ips.length) throw new Error('No hay una interfaz de red privada IPv4 disponible');
const ip = process.env.MUSE_REMOTE_LAN_IP || ips[0];
if (!ips.includes(ip)) throw new Error('MUSE_REMOTE_LAN_IP debe ser una de las IP locales');
const url = 'https://' + ip + ':' + port;
const query = new URLSearchParams({ url, pin, token });
const fallback = process.env.MUSE_REMOTE_TAILSCALE_URL;
if (fallback) {
  if (!/^https:\/\//.test(fallback)) throw new Error('URL Tailscale debe ser HTTPS');
  query.set('fallback', fallback);
}
const pairing = 'muse://pair?' + query.toString();
console.log('\nPareamiento Muse Remote para ' + os.hostname());
console.log('URL local: ' + url);
console.log('Huella TLS SHA-256: ' + pin.toUpperCase());
console.log('La app puede descubrir otra IP de esta misma PC usando mDNS.\n');
console.log('¡El QR contiene tu token privado! No publiques esta pantalla.');
try {
  require('qrcode-terminal').generate(pairing, {small:true});
} catch(e) {
  console.error('Instala dependencias con npm install para obtener el QR: '+e.message);
  // Avoid printing token into terminal logs by default.
  process.exitCode = 1;
}
