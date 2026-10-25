'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {readContributorSettings,saveContributorSettings}=require('../contributor');

test('Contributor reads saved host privacy setting without side effects',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-contributor-'));
  const file=path.join(dir,'settings.json');
  try{
    fs.writeFileSync(file,JSON.stringify({schema_version:2,model:'test',contributor_mode_enabled:false,other:{nested:true}}));
    const result=readContributorSettings(file,{});
    assert.equal(result.available,true);
    assert.equal(result.value,false);
    assert.equal(result.needsRestart,false);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).other.nested,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('Contributor requires explicit data training consent and preserves unrelated settings',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-contributor-'));
  const file=path.join(dir,'settings.json');
  try{
    fs.writeFileSync(file,JSON.stringify({model:'muse',contributor_mode_enabled:false,permissions:{default_profile:'default'}}));
    assert.throws(()=>saveContributorSettings(true,false,file,{}),/acept/);
    assert.equal(readContributorSettings(file,{}).value,false);
    const status=saveContributorSettings(true,true,file,{});
    assert.equal(status.value,true);
    assert.equal(status.needsRestart,true);
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(saved.permissions.default_profile,'default');
    assert.equal(saved.contributor_mode_disclosure_acknowledged,true);
    const off=saveContributorSettings(false,false,file,{});
    assert.equal(off.value,false);
    assert.equal(off.needsRestart,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('Contributor refuses override, malformed configuration, and missing settings',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muse-contributor-'));
  const file=path.join(dir,'settings.json');
  try{
    fs.writeFileSync(file,JSON.stringify({contributor_mode_enabled:true}));
    assert.equal(readContributorSettings(file,{MUSE_CONTRIBUTOR_MODE:'0'}).available,false);
    assert.throws(()=>saveContributorSettings(false,false,file,{MUSE_CONTRIBUTOR_MODE:'1'}),/override/);
    assert.equal(readContributorSettings(path.join(dir,'missing.json'),{}).available,false);
    fs.writeFileSync(file,'INVALID JSON');
    assert.equal(readContributorSettings(file,{}).available,false);
    assert.throws(()=>saveContributorSettings(true,true,file,{}),/configura|configuraci/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
