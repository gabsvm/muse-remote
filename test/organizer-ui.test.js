'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const store=new Map();
global.localStorage={
  getItem:k=>store.get(k)||null,
  setItem:(k,v)=>store.set(k,String(v)),
  removeItem:k=>store.delete(k),
};
// Node exposes WebCrypto as a read-only global.
const organizer=require('../public/organizer-ui');

test('Local browser organizer can create projects and pin/rename/assign without MSP requests',()=>{
  organizer.addProject('Proyecto A','C:/Dev');
  const local=organizer.read();
  assert.equal(local.projects.length,1);
  const id=local.projects[0].id;
  organizer.togglePin('session-1');
  organizer.setAlias('session-1','Chat personalizado');
  organizer.setAssignment('session-1',id);
  assert.equal(organizer.isPinned('session-1'),true);
  assert.equal(organizer.alias('session-1'),'Chat personalizado');
  assert.equal(organizer.projectName('session-1'),'Proyecto A');
  organizer.togglePin('session-1');
  assert.equal(organizer.isPinned('session-1'),false);
  assert.equal(organizer.read().assignments['session-1'],id);
});
test('Local browser organizer refuses invalid data and stays unchanged on bad edits',()=>{
  const before=JSON.stringify(organizer.read());
  assert.throws(()=>organizer.setAlias('session-1','bad\u0001value'),/inválido/i);
  assert.throws(()=>organizer.addProject(''),/inválido/i);
  assert.throws(()=>organizer.setAssignment('session-1','nonexistent'),/inexistente/i);
  assert.equal(JSON.stringify(organizer.read()),before);
});
test('Only organizer metadata serialized locally, not credentials or draft bodies',()=>{
  const keys=Object.keys(organizer.read());
  assert.deepEqual(keys,['v','projects','assignments','aliases','pinned']);
  assert.ok(!JSON.stringify(organizer.read()).includes('muse-remote-token'));
});
