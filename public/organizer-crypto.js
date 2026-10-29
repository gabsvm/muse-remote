'use strict';
/** Portable E2EE organizer sync, WebCrypto AES-256-GCM PBKDF2-SHA256.
 * Passphrase is never persisted, sent or logged.
 */
(function(root,factory) {
  const api=factory();
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  if(root && root.document) root.MuseOrganizerCrypto=api;
})(typeof window==='undefined'?null:window,function(){
  const AAD=new TextEncoder().encode('muse-remote-organizer-v1');
  const ITER=310000;
  function checkPassword(pass) {
    if(typeof pass!=='string' || pass.length<12 || pass.length>128 ||
      !/^[\x20-\x7e]+$/.test(pass)) throw Error('Frase de 12 a 128 caracteres ASCII sin controles.');
  }
  function base64(bytes) {
    let text='';
    for(let i=0;i<bytes.length;i+=8192){
      text+=String.fromCharCode(...bytes.subarray(i,i+8192));
    }
    return btoa(text);
  }
  function unbase64(s,length) {
    if(typeof s!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(s)||s.length%4)throw Error('Base64 inválido.');
    const raw=atob(s),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if(length!==undefined && bytes.length!==length)throw Error('Longitud de vector inválida.');
    return bytes;
  }
  async function derive(pass,salt) {
    checkPassword(pass);
    const w=globalThis.crypto || (typeof require==='function' ? require('node:crypto').webcrypto : null);
    if(!w?.subtle) throw Error('Cifrado requiere HTTPS / WebCrypto.');
    const key=await w.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
    return w.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITER,hash:'SHA-256'},key,
      {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  function validateData(data) {
    if(!data||typeof data!=='object'||Array.isArray(data)||data.v!==1)throw Error('Versión incompatible.');
    const projects=(Array.isArray(data.projects)?data.projects:[]).slice(0,100);
    const validProjects=projects.map(p=>{
      if(!p||typeof p.id!=='string'||p.id.length>160||!p.id||
        typeof p.name!=='string'||!p.name.trim()||p.name.length>64||
        typeof p.workspace!=='string'||p.workspace.length>512)throw Error('Proyecto inválido.');
      return {id:p.id,name:p.name,workspace:p.workspace};
    });
    function mappings(key,maxLen) {
      const obj=data[key]||{};
      if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).length>10000)
        throw Error('Asignaciones o alias inválidos.');
      const out=Object.create(null);
      for(const [id,value] of Object.entries(obj)){
        if(!id||id.length>160||typeof value!=='string'||!value||value.length>maxLen||
           /[\u0000-\u001f\u007f]/.test(value))throw Error('Identificador o nombre inválido.');
        out[id]=value;
      }
      return out;
    }
    const pinned=(Array.isArray(data.pinned)?data.pinned:[]);
    if(pinned.length>10000||pinned.some(id=>typeof id!=='string'||!id||id.length>160))
      throw Error('Chats fijados inválidos.');
    return {v:1,projects:validProjects,
      assignments:mappings('assignments',160),
      aliases:mappings('aliases',80),
      pinned:[...new Set(pinned)]};
  }
  function merge(local,remote,remoteWins=false) {
    const base=validateData(local),source=validateData(remote);
    const map=new Map(base.projects.map(p=>[p.id,p]));
    for(const p of source.projects){if(remoteWins || !map.has(p.id))map.set(p.id,p);}
    return validateData({v:1,projects:[...map.values()].slice(0,100),
      assignments:remoteWins?{...base.assignments,...source.assignments}:{...source.assignments,...base.assignments},
      aliases:remoteWins?{...base.aliases,...source.aliases}:{...source.aliases,...base.aliases},
      pinned:[...new Set([...base.pinned,...source.pinned])].slice(0,10000)});
  }
  async function encrypt(data,pass) {
    const safe=validateData(data);
    const w=globalThis.crypto || (typeof require==='function'?require('node:crypto').webcrypto:null);
    if(!w?.subtle)throw Error('Requiere conexión HTTPS o localhost.');
    const salt=w.getRandomValues(new Uint8Array(16)),iv=w.getRandomValues(new Uint8Array(12));
    const key=await derive(pass,salt);
    const plaintext=new TextEncoder().encode(JSON.stringify(safe));
    if(plaintext.length>130000)throw Error('Organización demasiado grande.');
    const ciphertext=await w.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,plaintext);
    return {v:1,salt:base64(salt),iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext))};
  }
  async function decrypt(envelope,pass) {
    if(!envelope||envelope.v!==1||typeof envelope.ciphertext!=='string'||
      envelope.ciphertext.length>260000)throw Error('Copia cifrada inválida.');
    const salt=unbase64(envelope.salt,16),iv=unbase64(envelope.iv,12);
    const ciphertext=unbase64(envelope.ciphertext);
    const key=await derive(pass,salt);
    try{
      const plain=await (globalThis.crypto||require('node:crypto').webcrypto).subtle.decrypt(
        {name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,ciphertext);
      return validateData(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));
    }catch(e){throw Error('Frase incorrecta o copia modificada.');}
  }
  return {validateData,merge,encrypt,decrypt,checkPassword};
});
