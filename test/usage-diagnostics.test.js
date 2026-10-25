'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeUsageReport}=require('../usage-diagnostics');
const {server,HOST}=require('../server');

test('CLI says server sent no usage: surface precise truth, no invented percentages',()=>{
  const r=normalizeUsageReport(JSON.stringify({
    schemaVersion:1, allowance:null, reason:'server_sent_no_usage',
    hint:'provider report contained no usage percentages',
    secretShouldNeverLeak:'irrelevant'
  }), 1000);
  assert.equal(r.available,false);
  assert.equal(r.reason,'server_sent_no_usage');
  assert.equal(r.checkedAtMs,1000);
  assert.match(r.message,/no devolvió porcentajes/);
  assert.doesNotMatch(JSON.stringify(r),/secretShouldNeverLeak|irrelevant|hint/);
});

test('CLI diagnostic only indicates availability and drops private provider payloads',()=>{
  const r=normalizeUsageReport(JSON.stringify({
    schemaVersion:1, allowance:{window: {usedPercent:42},accountEmail:'private@example.com'}
  }), 2000);
  assert.equal(r.available,true);
  assert.equal(r.reason,'available');
  assert.doesNotMatch(JSON.stringify(r),/@|42/);
  assert.throws(()=>normalizeUsageReport('not json'),SyntaxError);
});

test('quota diagnostic endpoint refuses all anonymous requests before starting CLI',async()=>{
  await new Promise(resolve=>server.listen(0,HOST,resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port+'/api/usage-diagnostics';
    const r=await fetch(base);
    assert.equal(r.status,401);
    const j=await r.json();
    assert.deepEqual(j,{ok:false,error:'unauthorized'});
  }finally{await new Promise(resolve=>server.close(resolve))}
});
