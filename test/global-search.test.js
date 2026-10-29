'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  transcriptItems, excerpt, hitsFromSession, pickSessions, scan,
} = require('../public/global-search.js');

const session = (id,n) => ({sessionId:id, name:'Chat '+id, turnCount:2,updatedAt:'2026-10-'+String(n).padStart(2,'0')});
const message = (kind,text,id='m1') => ({kind,text,itemId:id});

test('global search reads only user and assistant messages; excludes tools and reasoning',()=>{
  const history={items:[
    message('toolCall','secret-command: password'),
    message('reasoning','secret internal'),
    message('userMessage','Tengo un BUG de scroll', 'm2'),
    message('agentMessage','Fix del bug aplicado', 'm3'),
  ]};
  const hits=hitsFromSession(session('s1',1),history,'BUG');
  assert.deepEqual(hits.map(x=>x.itemId),['m2','m3']);
  assert.ok(!hits.some(x=>x.excerpt.includes('secret')));
});
test('snapshot and inline history both supported',()=>{
  const items=[message('agentMessage','Clave correcta')];
  assert.deepEqual(transcriptItems({items}),items);
  assert.deepEqual(transcriptItems({snapshot:{state:{items}}}),items);
  assert.deepEqual(transcriptItems({}),[]);
});
test('bounded selection respects hidden sessions and most recent first',()=>{
  const sessions=Array.from({length:60},(_,i)=>session('id'+i,(i%28)+1));
  const picked=pickSessions(sessions,{hidden:['id0','id2']});
  assert.equal(picked.length,30);
  assert.ok(!picked.some(x=>x.sessionId==='id0' || x.sessionId==='id2'));
  assert.ok(picked[0].updatedAt>=picked.at(-1).updatedAt);
  assert.ok(pickSessions(sessions,{hidden:['id0'],includeHidden:true}).some(x=>x.sessionId==='id0') ||
    pickSessions(sessions,{hidden:['id0'],includeHidden:true}).length===30);
});
test('search caps result count and excludes huge payloads',()=>{
  const h={items:[...Array.from({length:100},(_,i)=>message('agentMessage','hola world','id'+i)),
    message('agentMessage','hola'+'a'.repeat(260000),'huge')]};
  const hits=hitsFromSession(session('one',2),h,'hola');
  assert.equal(hits.length,5);
  assert.ok(hits.every(x=>x.excerpt.length<=222));
});
test('search scans bounded sessions and updates progress without model calls',async()=>{
  let running=0,peak=0,read=0;
  const state=[];
  const sessions=Array.from({length:40},(_,i)=>session('s'+i,i%28+1));
  const found=await scan({sessions,query:'motor',
    readSession:async(id)=> {
      running++;peak=Math.max(peak,running);read++;
      await new Promise(resolve=>setTimeout(resolve,2));
      running--;
      return {history:{items:[message('userMessage','Mi motor de búsqueda '+id)]}};
    },
    onProgress:p=>state.push(p.done),
  });
  assert.equal(read,30);
  assert.ok(peak<=2);
  assert.equal(found.failed,0);
  assert.equal(found.done,30);
  assert.equal(found.results.length,30);
  assert.equal(state.at(-1),30);
});
test('cancel stops further dispatch and results are marked partial',async()=>{
  const controller=new AbortController();
  let read=0;
  const out=await scan({sessions:Array.from({length:20},(_,i)=>session('s'+i,i+1)),query:'hola',
    signal:controller.signal,
    readSession:async()=> {read++;controller.abort();return {history:{items:[message('userMessage','hola')]}};},
  });
  assert.equal(out.cancelled,true);
  assert.equal(out.results.length,0);
  assert.ok(read<=2);
});
test('error count explicit; no false exhaustive-result claim',async()=>{
  const result=await scan({sessions:[session('a',1),session('b',2)],query:'hola',
    readSession:async id=>{if(id==='b') throw Error('unavailable');return {history:{items:[message('userMessage','hola')]}};},
  });
  assert.equal(result.failed,1);
  assert.equal(result.done,2);
  assert.equal(result.results.length,1);
});
test('rejects queries shorter than three chars and non-readers',async()=>{
  await assert.rejects(()=>scan({query:'ab',sessions:[],readSession:()=>{}}),/3 caracteres/);
  await assert.rejects(()=>scan({query:'valid',sessions:[]}),/lector|lectura/i);
  assert.equal(excerpt('HOLA Mundo','hola').includes('HOLA'),true);
});
