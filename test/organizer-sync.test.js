'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'muse-organizer-tests-'));
process.env.MUSE_REMOTE_ORGANIZER_FILE=path.join(directory,'backup.json');
process.env.MUSE_REMOTE_TOKEN='organizer-tests-only-token-123456789';
const {server,HOST}=require('../server');
const {OrganizerSyncStore,validateEnvelope}=require('../organizer-sync-store');
const codec=require('../public/organizer-crypto');
const live=path.join(directory,'local.json');
const store=new OrganizerSyncStore(live);
const data={v:1,projects:[{id:'p1',name:'Muse Remote',workspace:'C:/Dev'}],
  assignments:{s1:'p1'},aliases:{s1:'Mi proyecto'},pinned:['s1']};
let url='';
before(async()=>{
  await new Promise(resolve=>server.listen(0,HOST,resolve));
  url='http://'+HOST+':'+server.address().port;
});
after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(directory,{recursive:true,force:true});
});
const auth={authorization:'Bearer organizer-tests-only-token-123456789'};

test('WebCrypto PBKDF2 AES-GCM encrypts real metadata and decrypts with correct phrase',async()=>{
  const one=await codec.encrypt(data,'test-cipher-key-2026');
  const two=await codec.encrypt(data,'test-cipher-key-2026');
  assert.ok(validateEnvelope(one));
  assert.notEqual(one.iv,two.iv);
  assert.equal(JSON.stringify(one).includes('Mi proyecto'),false);
  const restored=await codec.decrypt(one,'test-cipher-key-2026');
  assert.deepEqual(JSON.parse(JSON.stringify(restored)),data);
  await assert.rejects(codec.decrypt(one,'wrong-secret-key-2026'),/incorrecta|modificada/);
  const tampered={...one,ciphertext:one.ciphertext.replace(/^./,one.ciphertext[0]==='a'?'b':'a')};
  await assert.rejects(codec.decrypt(tampered,'test-cipher-key-2026'),/incorrecta|modificada/);
});
test('merging protects local conflicts by default; remote wins only if requested',()=>{
  const local={...data,aliases:{s1:'Local'}, pinned:['s1','s2']};
  const remote={...data,aliases:{s1:'Remoto',s3:'Nuevo'},pinned:['s3']};
  const safe=codec.merge(local,remote);
  assert.equal(safe.aliases.s1,'Local');
  assert.equal(safe.aliases.s3,'Nuevo');
  assert.deepEqual(safe.pinned,['s1','s2','s3']);
  assert.equal(codec.merge(local,remote,true).aliases.s1,'Remoto');
});
test('server validates schema and enforces compare-and-swap revisions',async()=>{
  const env=await codec.encrypt(data,'test-cipher-key-2026');
  assert.deepEqual(store.read(),{revision:0,envelope:null});
  assert.equal(store.write(0,{secret:'plaintext'}).reason,'invalidEnvelope');
  assert.equal(store.write(0,env).revision,1);
  assert.equal(store.write(0,env).reason,'conflict');
  assert.equal(store.write(1,env).revision,2);
  assert.equal(store.read().revision,2);
  assert.equal(fs.readFileSync(live,'utf8').includes('Mi proyecto'),false);
});
test('API rejects unauthenticated reads and writes and stores only opaque data',async()=>{
  const encrypted=await codec.encrypt(data,'test-cipher-key-2026');
  assert.equal((await fetch(url+'/api/organizer-sync')).status,401);
  assert.equal((await fetch(url+'/api/organizer-sync',{method:'PUT',body:'{}'})).status,401);
  let response=await fetch(url+'/api/organizer-sync',{headers:auth});
  let body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.revision,0);
  assert.equal(body.envelope,null);
  response=await fetch(url+'/api/organizer-sync',{method:'PUT',
    headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify({expectedRevision:0,envelope:encrypted})});
  assert.equal(response.status,200);
  assert.equal((await response.json()).revision,1);
  response=await fetch(url+'/api/organizer-sync',{headers:auth});
  body=await response.json();
  assert.equal(body.envelope.ciphertext,encrypted.ciphertext);
  assert.equal(JSON.stringify(body).includes('Mi proyecto'),false);
  response=await fetch(url+'/api/organizer-sync',{method:'PUT',
    headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify({expectedRevision:0,envelope:encrypted})});
  assert.equal(response.status,409);
  response=await fetch(url+'/api/organizer-sync',{method:'PUT',
    headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify({expectedRevision:1,envelope:{...encrypted,name:'exposure'}})});
  assert.equal(response.status,400);
});
