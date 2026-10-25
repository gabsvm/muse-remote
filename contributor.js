'use strict';
// Contributor is a host-wide Muse Code privacy preference (not a model ID).
// The remote client can only toggle a saved, explicitly initialized boolean.
// No CLI/model/API call is made and no other settings are returned to the client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SETTINGS = path.join(os.homedir(), '.config', 'muse', 'settings.json');
const OVERRIDE_MESSAGE = 'Contributor está controlado por MUSE_CONTRIBUTOR_MODE en la PC.';
const ERROR_MESSAGE = 'No se pudo leer la configuración local segura de Muse.';
function loadSettings(settingsPath) {
  // Keep the same open descriptor for fstat + read, avoiding a path check/read
  // race. O_NOFOLLOW prevents symlink traversal on systems that support it.
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(settingsPath, flags);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 256 * 1024) throw Error('INVALID_SETTINGS');
    const raw = fs.readFileSync(fd, { encoding: 'utf8' });
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('INVALID_SETTINGS');
    if (data.contributor_mode_enabled !== undefined &&
      typeof data.contributor_mode_enabled !== 'boolean') throw Error('INVALID_SETTINGS');
    return data;
  } finally { fs.closeSync(fd); }
}

function readContributorSettings(settingsPath = DEFAULT_SETTINGS, env = process.env) {
  if (env.MUSE_CONTRIBUTOR_MODE !== undefined) {
    return { available: false, value: null, override: true,
      needsRestart: false, reason: OVERRIDE_MESSAGE };
  }
  try {
    const data = loadSettings(settingsPath);
    const value = data.contributor_mode_enabled;
    return { available: typeof value === 'boolean', value: typeof value === 'boolean' ? value : null,
      override: false, needsRestart: false,
      reason: typeof value === 'boolean' ? null :
        'Contributor no está inicializado: abrí /settings en Muse Code desde la PC.' };
  } catch (e) {
    return { available: false, value: null, override: false,
      needsRestart: false, reason: e.code === 'ENOENT' ?
        'Falta la configuración de Muse; abrí /settings desde la PC.' : ERROR_MESSAGE };
  }
}

function saveContributorSettings(enabled, confirmed, settingsPath = DEFAULT_SETTINGS, env = process.env) {
  if (typeof enabled !== 'boolean') throw Error('Se requiere on/off.');
  if (enabled && confirmed !== true) throw Error('Antes de activar Contributor, aceptá expresamente el uso de datos para entrenamiento.');
  if (env.MUSE_CONTRIBUTOR_MODE !== undefined) throw Error(OVERRIDE_MESSAGE);
  let data;
  try { data = loadSettings(settingsPath); }
  catch { throw Error(ERROR_MESSAGE); }
  if (typeof data.contributor_mode_enabled !== 'boolean')
    throw Error('Inicializá primero el modo Contributor en /settings de Muse Code.');
  if (data.contributor_mode_enabled === enabled) return {
    available: true, value: enabled, override: false, needsRestart: false, reason: null,
  };
  data.contributor_mode_enabled = enabled;
  if (enabled) data.contributor_mode_disclosure_acknowledged = true;
  const tmp = settingsPath + '.muse-remote-' + crypto.randomBytes(5).toString('hex');
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, settingsPath);
  } catch { throw Error('No se pudo guardar la preferencia Contributor. Revisá los permisos en la PC.'); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
  return { available: true, value: enabled, override: false, needsRestart: true,
    reason: 'Guardado en la PC. Reiniciá Muse Remote para aplicar el cambio al proceso actual.' };
}
module.exports = { readContributorSettings, saveContributorSettings };
