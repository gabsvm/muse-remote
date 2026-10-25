'use strict';
// Contributor mode is a host-wide Muse Code privacy preference, not a model picker.
// This helper reads/writes only the explicit boolean setting. It never invokes Muse.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SETTINGS = path.join(os.homedir(), '.config', 'muse', 'settings.json');
function readContributorSettings(settingsPath = DEFAULT_SETTINGS, env = process.env) {
  if (env.MUSE_CONTRIBUTOR_MODE !== undefined) {
    return { available: false, value: null, override: true, needsRestart: false,
      reason: 'El proceso Muse está configurado con MUSE_CONTRIBUTOR_MODE; cambiá ese override en la PC.' };
  }
  try {
    const stat = fs.lstatSync(settingsPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) {
      throw Error('Configuración de Muse no es un archivo JSON local seguro.');
    }
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const val = data.contributor_mode_enabled;
    if (val !== undefined && typeof val !== 'boolean') throw Error('Estado Contributor inválido.');
    return {
      available: typeof val === 'boolean',
      value: typeof val === 'boolean' ? val : null,
      override: false,
      needsRestart: false,
      reason: typeof val === 'boolean' ? null :
        'El modo Contributor no está inicializado; configuralo primero en Muse Code con /settings.',
    };
  } catch (e) {
    return { available: false, value: null, override: false, needsRestart: false,
      reason: e.code === 'ENOENT' ? 'No existe configuración de Muse. Abrí /settings en la PC.' :
        'No se pudo leer la configuración segura de Muse: ' + e.message };
  }
}

function saveContributorSettings(enabled, confirmed, settingsPath = DEFAULT_SETTINGS, env = process.env) {
  if (typeof enabled !== 'boolean') throw Error('Se requiere un estado booleano.');
  if (enabled && confirmed !== true) throw Error('Antes de activar Contributor aceptá expresamente el uso de datos para entrenamiento.');
  const status = readContributorSettings(settingsPath, env);
  if (!status.available || status.override) throw Error(status.reason || 'Modo no disponible.');
  const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (data.contributor_mode_enabled === enabled) return {
    available: true, value: enabled, override: false, needsRestart: false,
    reason: null,
  };
  data.contributor_mode_enabled = enabled;
  // Explicit consent is recorded only when the owner turns it on.
  if (enabled) data.contributor_mode_disclosure_acknowledged = true;
  const file = settingsPath + '.muse-remote-' + crypto.randomBytes(5).toString('hex');
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(file, settingsPath);
  } finally {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
  return { available: true, value: enabled, override: false, needsRestart: true,
    reason: 'Guardado en la PC. Reiniciá Muse Remote y Muse Code para aplicar el cambio. ' +
      'No se afirma que el proceso actual haya cambiado.' };
}
module.exports = { readContributorSettings, saveContributorSettings };
