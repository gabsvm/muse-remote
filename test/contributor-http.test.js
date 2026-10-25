'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {server,HOST}=require('../server');

test('Contributor HTTP setting requires bearer authentication and cannot be changed anonymously',async()=>{
  await new Promise(resolve=>server.listen(0,HOST,resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/contributor';
  try{
    const status=await fetch(base);
    assert.equal(status.status,401);
    const mutation=await fetch(base,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({enabled:false,confirmed:true})});
    assert.equal(mutation.status,401);
  }finally{await new Promise(resolve=>server.close(resolve))}
});
