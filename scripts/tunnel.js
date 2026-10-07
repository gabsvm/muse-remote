// Arranca el backend y un tunel de Cloudflare en un solo comando.
//
//   npm run tunnel -- --mail tu@correo.com              (quick tunnel protegido)
//   npm run tunnel -- --mail tu@correo.com --mail '*@empresa.com'
//   npm run tunnel -- --name muse --hostname muse.tudominio.com   (tunel con nombre, URL fija)
//   npm run tunnel -- --public                          (quick tunnel SIN correo; desaconsejado)
//
// Correos tambien por entorno: MUSE_REMOTE_ALLOWED_MAIL="a@b.com,*@empresa.com".
// El backend sigue escuchando solo en 127.0.0.1: cloudflared conecta desde
// este mismo PC y es lo unico que queda expuesto.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv, env = process.env) {
  const o = { mails: [], name: null, hostname: null, public: false, port: Number(env.MUSE_REMOTE_PORT || 8787), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`falta el valor de ${a}`);
      return v;
    };
    if (a === '--mail' || a === '--allowed-mail') o.mails.push(next());
    else if (a === '--name') o.name = next();
    else if (a === '--hostname') o.hostname = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--public') o.public = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('opcion desconocida: ' + a);
  }
  if (env.MUSE_REMOTE_ALLOWED_MAIL) {
    for (const m of String(env.MUSE_REMOTE_ALLOWED_MAIL).split(',')) if (m.trim()) o.mails.push(m.trim());
  }
  o.mails = [...new Set(o.mails)];
  for (const m of o.mails) {
    if (!/^(\*|[^@\s*]+)@[^@\s]+\.[^@\s]+$/.test(m)) throw new Error('correo no valido: ' + m);
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('puerto no valido');
  if (!o.name && !o.mails.length && !o.public) {
    throw new Error('indica al menos un --mail (recomendado) o --public para un tunel sin proteccion por correo');
  }
  return o;
}

// Argumentos para cloudflared segun el modo.
function cloudflaredArgs(o) {
  // 127.0.0.1 y no localhost: en Windows localhost puede resolver a ::1 y el
  // backend solo escucha en IPv4 (cloudflared devolveria 502).
  const origin = `http://127.0.0.1:${o.port}`;
  if (o.name) return ['tunnel', '--no-autoupdate', 'run', '--url', origin, o.name];
  const args = ['tunnel', '--no-autoupdate', '--url', origin];
  for (const m of o.mails) args.push('--allowed-mail', m);
  return args;
}

// Extrae la URL publica del log de cloudflared (quick tunnel).
function findTunnelUrl(text) {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i.exec(String(text || ''));
  return m ? m[0] : null;
}

// Pistas para errores tipicos de cloudflared.
function hintFor(text) {
  const t = String(text || '');
  if (/flag provided but not defined:.*allowed-mail/i.test(t)) {
    return 'Tu cloudflared no soporta --allowed-mail: actualizalo (winget upgrade Cloudflare.cloudflared / brew upgrade cloudflared).';
  }
  if (/Cannot determine default origin certificate|cert\.pem/i.test(t)) {
    return 'El tunel con nombre requiere iniciar sesion: cloudflared tunnel login (y crear el tunel: cloudflared tunnel create <nombre>).';
  }
  if (/Tunnel not found|Cannot find tunnel/i.test(t)) {
    return 'No existe ese tunel: crealo con cloudflared tunnel create <nombre> y enruta el DNS con cloudflared tunnel route dns <nombre> <hostname>.';
  }
  return null;
}

const HELP = `Uso: npm run tunnel -- [opciones]

  --mail <correo>      Correo autorizado (repetible; admite '*@dominio.com').
                       Cloudflare pide ese correo y un PIN antes de entrar.
  --name <tunel>       Usa un tunel con nombre (URL fija, requiere cuenta y dominio).
  --hostname <host>    Hostname del tunel con nombre (solo para mostrarlo).
  --port <n>           Puerto del backend (def. 8787 o MUSE_REMOTE_PORT).
  --public             Quick tunnel sin proteccion por correo (solo token).

Correos tambien con MUSE_REMOTE_ALLOWED_MAIL="a@b.com,*@empresa.com".`;

async function waitForBackend(port, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch { /* aun no escucha */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function banner(lines) {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '='.repeat(w);
  console.log('\n' + bar);
  for (const l of lines) console.log('  ' + l);
  console.log(bar + '\n');
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) {
    if (process.argv.includes('-h') || process.argv.includes('--help')) { console.log(HELP); return; }
    console.error('Error: ' + e.message + '\n\n' + HELP);
    process.exit(2);
  }
  if (o.help) { console.log(HELP); return; }

  const env = { ...process.env, MUSE_REMOTE_PORT: String(o.port) };
  const backend = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: 'inherit' });
  let cf = null;
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    try { if (cf) cf.kill(); } catch { /* noop */ }
    try { backend.kill(); } catch { /* noop */ }
    setTimeout(() => process.exit(code), 300);
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  backend.on('exit', (code) => { if (!stopping) { console.error('[tunnel] el backend termino (' + code + ')'); stop(code || 1); } });

  if (!(await waitForBackend(o.port))) {
    console.error('[tunnel] el backend no respondio en el puerto ' + o.port);
    return stop(1);
  }

  cf = spawn('cloudflared', cloudflaredArgs(o), { stdio: ['ignore', 'pipe', 'pipe'] });
  cf.on('error', (e) => {
    if (e.code === 'ENOENT') {
      console.error('\n[tunnel] No se encontro cloudflared. Instalalo:\n'
        + '  Windows: winget install --id Cloudflare.cloudflared\n'
        + '  macOS:   brew install cloudflared\n'
        + '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n');
    } else console.error('[tunnel] cloudflared: ' + e.message);
    stop(1);
  });
  let shown = false;
  let log = '';
  const onData = (d) => {
    const s = d.toString();
    log = (log + s).slice(-8000);
    if (process.env.MUSE_REMOTE_TUNNEL_VERBOSE) process.stderr.write(s);
    const hint = hintFor(s);
    if (hint) console.error('[tunnel] ' + hint);
    if (!shown) {
      const url = o.name ? (/Registered tunnel connection/i.test(s) ? (o.hostname ? 'https://' + o.hostname : '(tu hostname del tunel)') : null) : findTunnelUrl(s);
      if (url) {
        shown = true;
        banner([
          'Muse Remote disponible en:',
          url,
          '',
          o.mails.length ? 'Acceso: correo + PIN (' + o.mails.join(', ') + ') y despues el token.'
            : o.name ? 'Acceso: protege el hostname con Cloudflare Access (Zero Trust).'
              : 'AVISO: sin proteccion por correo; solo el token protege el acceso.',
          o.name ? 'URL fija: instala la PWA una vez y listo.'
            : 'Quick tunnel: la URL cambia en cada arranque (reinstala la PWA/push).',
          'Ctrl+C para parar.',
        ]);
      }
    }
  };
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);
  cf.on('exit', (code) => {
    if (stopping) return;
    console.error('[tunnel] cloudflared termino (' + code + ').');
    if (!shown) console.error(log.split('\n').slice(-15).join('\n'));
    stop(code || 1);
  });
}

if (require.main === module) main();

module.exports = { parseArgs, cloudflaredArgs, findTunnelUrl, hintFor };
