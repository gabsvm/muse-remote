'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FORMAT_VERSION = 1;
const MAX_CIPHER_BYTES = 196608;
const MAX_ENVELOPE_BYTES = 275000;
const DEFAULT_FILE = path.join(__dirname, '.organizer-sync.v1.json');

function validBase64(value, minBytes, maxBytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
      value.length % 4 !== 0 || value.length > Math.ceil(maxBytes / 3) * 4 + 4) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= minBytes && bytes.length <= maxBytes &&
    bytes.toString('base64') === value;
}

function validateEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  if (keys.length !== 4 || !['v','salt','iv','ciphertext'].every(k => keys.includes(k))) return false;
  return input.v === FORMAT_VERSION &&
    validBase64(input.salt, 16, 16) &&
    validBase64(input.iv, 12, 12) &&
    validBase64(input.ciphertext, 16, MAX_CIPHER_BYTES);
}

class OrganizerSyncStore {
  constructor(filename = DEFAULT_FILE) { this.file = filename; }
  read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      if (Buffer.byteLength(raw) > MAX_ENVELOPE_BYTES) throw Error('invalid encrypted backup size');
      const obj = JSON.parse(raw);
      if (!Number.isSafeInteger(obj.revision) || obj.revision < 1 ||
          !validateEnvelope(obj.envelope)) throw Error('invalid encrypted backup format');
      return {revision: obj.revision, envelope: obj.envelope};
    } catch (e) {
      if (e.code === 'ENOENT') return {revision:0, envelope:null};
      throw e;
    }
  }
  write(expectedRevision, envelope) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return {ok:false, reason:'invalidRevision'};
    }
    if (!validateEnvelope(envelope)) return {ok:false, reason:'invalidEnvelope'};
    const prior = this.read();
    if (prior.revision !== expectedRevision) {
      return {ok:false, reason:'conflict', revision:prior.revision};
    }
    const revision = prior.revision + 1;
    const payload = JSON.stringify({revision,envelope}) + '\n';
    if (Buffer.byteLength(payload) > MAX_ENVELOPE_BYTES) return {ok:false,reason:'tooLarge'};
    // The user may have an existing backup: retain it until the replacement is durable.
    const tmp = this.file + '.' + process.pid + '.' + require('node:crypto').randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, payload, {encoding:'utf8',flag:'wx',mode:0o600});
      fs.renameSync(tmp, this.file);
    } finally {
      try {fs.unlinkSync(tmp);} catch {}
    }
    return {ok:true,revision};
  }
}
module.exports = {OrganizerSyncStore, validateEnvelope, MAX_CIPHER_BYTES};
