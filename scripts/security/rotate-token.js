#!/usr/bin/env node
'use strict';
// Local-only break-glass revocation for all paired devices. Never prints tokens.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');

function listenerActive(port=8787) {
  return new Promise(resolve=>{
    const socket=net.connect({host:'127.0.0.1',port});
    const done=v=>{socket.destroy();resolve(v)};
    socket.setTimeout(1200,()=>done(false));
    socket.once('connect',()=>done(true));
    socket.once('error',()=>done(false));
  });
}
async function rotateToken({tokenFile=path.join(ROOT,'.token'),port=8787,env=process.env}={}) {
  if(env.MUSE_REMOTE_TOKEN) throw Error('MUSE_REMOTE_TOKEN environment override is active: remove it before rotation');
  if(await listenerActive(port)) throw Error('Local Muse Remote server is running: stop it before rotating tokens');
  let existing;
  try{existing=fs.readFileSync(tokenFile,'utf8').trim()}catch(e){if(e.code==='ENOENT')throw Error('No existing token: nothing to revoke');throw e}
  if(existing.length<16)throw Error('Existing token is malformed; stop and inspect manually');
  const next=crypto.randomBytes(32).toString('hex');
  const tmp=tokenFile+'.rotate-'+crypto.randomBytes(6).toString('hex');
  try{
    fs.writeFileSync(tmp,next+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(tmp,tokenFile);
  }finally{
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}
  }
  return {rotated:true,revoked:'all existing paired devices',file:tokenFile};
}
async function main(){
  if(!process.argv.includes('--confirm-revoke-all')){
    console.error('Usage: node scripts/security/rotate-token.js --confirm-revoke-all');
    console.error('Stop the backend first. This invalidates every paired device; the next server start prints the new token locally.');
    process.exitCode=2;
    return;
  }
  try {
    const result=await rotateToken();
    console.log('All previous Muse Remote device tokens revoked. Restart the server and re-pair devices.');
    console.log('Token file updated locally (token value withheld): '+path.basename(result.file));
  } catch(e) {
    console.error('Rotation refused: '+e.message);
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={listenerActive,rotateToken};
