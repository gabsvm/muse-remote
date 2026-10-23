'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {rotateToken}=require('../scripts/security/rotate-token');

test('explicit local rotation revokes old token without printing the new one',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-rotate-'));
  const file=path.join(dir,'.token');
  fs.writeFileSync(file,'a'.repeat(64)+'\n',{mode:0o600});
  try{
    const result=await rotateToken({tokenFile:file,port:1,env:{}});
    assert.equal(result.rotated,true);
    assert.equal(result.revoked,'all existing paired devices');
    const next=fs.readFileSync(file,'utf8').trim();
    assert.match(next,/^[a-f0-9]{64}$/);
    assert.notEqual(next,'a'.repeat(64));
    assert.ok(!JSON.stringify(result).includes(next));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('rotation refuses while local listener is active',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-rotate-active-'));
  const file=path.join(dir,'.token');
  fs.writeFileSync(file,'b'.repeat(64)+'\n');
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const port=server.address().port;
    await assert.rejects(rotateToken({tokenFile:file,port,env:{}}),/stop it/);
    assert.equal(fs.readFileSync(file,'utf8').trim(),'b'.repeat(64));
  }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});

test('rotation refuses API environment override',async()=>{
  await assert.rejects(rotateToken({env:{MUSE_REMOTE_TOKEN:'private'},port:1}),/environment override/);
});
