// Authenticated inbox for arbitrary documents transferred from Android.
// All files are written ONLY into a dedicated private directory on the PC.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INBOX_BYTES = 256 * 1024 * 1024;
const ROOT = path.join(__dirname, '.muse-uploads');

function cleanName(value) {
  if (typeof value !== 'string' || !value || value.length > 180) throw new Error('invalid filename');
  if (/[\\/\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..' ||
      value.trim().startsWith('.') || /[. ]$/.test(value)) throw new Error('invalid filename');
  const name = value.normalize('NFC').replace(/[^\p{L}\p{N}._() -]/gu, '_').trim();
  if (!name || name.length > 120 || /^(con|prn|nul|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error('invalid filename');
  return name;
}

async function writeUpload(buffer, name, directory = ROOT) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_UPLOAD_BYTES)
    throw new Error('file too large or empty');
  const safeName = cleanName(name);
  await fs.promises.mkdir(directory, {recursive: true, mode: 0o700});
  const dirStat = await fs.promises.lstat(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('invalid inbox');
  const existing = await fs.promises.readdir(directory, {withFileTypes:true});
  let total = 0;
  for (const entry of existing) {
    if (!entry.isFile()) throw new Error('invalid inbox entry');
    total += (await fs.promises.stat(path.join(directory, entry.name))).size;
  }
  if (total + buffer.length > MAX_INBOX_BYTES) throw new Error('inbox storage limit');
  const stored = crypto.randomUUID() + '-' + safeName;
  const destination = path.join(directory, stored);
  await fs.promises.writeFile(destination, buffer, {flag:'wx', mode:0o600});
  return {name:safeName, path:destination, size:buffer.length};
}

async function readUploadBody(req) {
  const claimed = Number(req.headers['content-length']);
  if (Number.isFinite(claimed) && claimed > MAX_UPLOAD_BYTES) throw new Error('file too large or empty');
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) throw new Error('file too large or empty');
    chunks.push(chunk);
  }
  if (!received) throw new Error('file too large or empty');
  return Buffer.concat(chunks);
}

module.exports = {cleanName, writeUpload, readUploadBody, MAX_UPLOAD_BYTES, MAX_INBOX_BYTES};
