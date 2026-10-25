'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const {execFile} = require('node:child_process');
const run = promisify(execFile);
const {loadOrCreateToken, server, HOST} = require('../server.js');

test('concurrent independent processes generate exactly one stable token', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-remote-token-'));
  const dest=path.join(dir,'.token');
  const script="process.stdout.write(require(process.argv[1]).loadOrCreateToken(process.argv[2],{}))";
  const modulePath=require.resolve('../server.js');
  try {
    const results=await Promise.all(Array.from({length:12},()=>run(process.execPath,['-e',script,modulePath,dest],{timeout:15000})));
    const tokens=results.map(x=>x.stdout);
    assert.equal(new Set(tokens).size,1,'every process must load exactly the same token');
    assert.equal(tokens[0],fs.readFileSync(dest,'utf8').trim());
    assert.match(tokens[0],/^[0-9a-f]{64}$/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('existing corrupt token fails closed instead of replacing it',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-remote-bad-token-'));
  const dest=path.join(dir,'.token');
  try {
    fs.writeFileSync(dest,'invalid\n');
    assert.throws(()=>loadOrCreateToken(dest,{}),/refusing to replace/);
    assert.equal(fs.readFileSync(dest,'utf8'),'invalid\n');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('unauthenticated health provides readiness but not internal MSP metadata',async()=>{
  await new Promise(resolve=>server.listen(0,HOST,resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/api/health';
    const res=await fetch(url);
    assert.equal(res.status,200);
    const data=await res.json();
    assert.equal(data.ok,true);
    assert.equal(data.version,'0.2.0-beta.5');
    assert.ok(!Object.prototype.hasOwnProperty.call(data,'serverInfo'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
