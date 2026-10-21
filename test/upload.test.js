'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {cleanName, writeUpload, readUploadBody, MAX_UPLOAD_BYTES} = require('../uploads');

test('filename sanitation rejects path traversal and dangerous Windows paths', () => {
  for (const n of ['../evil', 'folder\\evil', '..', '.hidden', 'CON', 'nul.txt',
    'a\0.txt', '', 'a'.repeat(190), 'file/', 'file.']) {
    assert.throws(() => cleanName(n), n);
  }
  assert.equal(cleanName('manual del proyecto.pdf'), 'manual del proyecto.pdf');
});

test('uploads write exact binary bytes only inside private inbox', async () => {
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'muse-upload-test-'));
  try {
    const content=Buffer.from([0, 255, 37, 0, 10, 55]);
    const uploaded=await writeUpload(content,'captura.png',dir);
    assert.equal(uploaded.name,'captura.png');
    assert.ok(uploaded.path.startsWith(dir+path.sep));
    assert.deepEqual(await fs.promises.readFile(uploaded.path),content);
    await assert.rejects(writeUpload(content,'../../secret',dir));
    assert.deepEqual(await fs.promises.readFile(uploaded.path),content);
  } finally { await fs.promises.rm(dir,{recursive:true,force:true}); }
});

test('bounded binary reader enforces limit and preserves nontext files', async () => {
  const bytes=Buffer.from([255,0,128,1,239]);
  const req=Readable.from([bytes]);req.headers={'content-length':bytes.length};
  assert.deepEqual(await readUploadBody(req),bytes);
  const tooBig=Readable.from([Buffer.alloc(MAX_UPLOAD_BYTES+1)]);
  tooBig.headers={};
  await assert.rejects(readUploadBody(tooBig),/too large/);
});
