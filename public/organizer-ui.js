'use strict';
/**
 * Local organizer UI and explicit E2EE backup exchange.
 * The backend receives ciphertext only. This does not sync passwords, drafts,
 * model settings, account IDs or session contents.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(root && root.document)root.MuseOrganizerUI=api;
})(typeof window==='undefined'?null:window,function(){
  const KEY='muse-remote-organizer-v1';
  let changed=()=>{};
  function empty(){return {v:1,projects:[],assignments:{},aliases:{},pinned:[]};}
  function read(){
    try{
      const data=JSON.parse(localStorage.getItem(KEY)||'null')||empty();
      return MuseCrypto().validateData(data);
    }catch{return empty();}
  }
  function MuseCrypto(){
    return typeof window!=='undefined'?window.MuseOrganizerCrypto:require('../public/organizer-crypto.js');
  }
  function save(data){
    const valid=MuseCrypto().validateData(data);
    localStorage.setItem(KEY,JSON.stringify(valid));
    changed();
  }
  function isPinned(id){return read().pinned.includes(id);}
  function alias(id){return read().aliases[id]||null;}
  function togglePin(id){
    const d=read();if(d.pinned.includes(id))d.pinned=d.pinned.filter(x=>x!==id);
    else d.pinned.push(id);save(d);
  }
  function setAlias(id,title){
    const t=String(title||'').trim();
    if(t.length>80||/[\u0000-\u001f\u007f]/.test(t))throw Error('Nombre inválido');
    const d=read();if(t)d.aliases[id]=t;else delete d.aliases[id];
    save(d);
  }
  function setAssignment(id,projectId){
    const d=read();
    if(projectId && !d.projects.some(x=>x.id===projectId))throw Error('Proyecto inexistente');
    if(projectId)d.assignments[id]=projectId;else delete d.assignments[id];
    save(d);
  }
  function addProject(name,workspace=''){
    const text=String(name||'').trim();
    if(!text || text.length>64 || String(workspace).length>512)throw Error('Datos del proyecto inválidos');
    const d=read();if(d.projects.length>=100)throw Error('Máximo 100 proyectos');
    d.projects.push({id:'p-'+crypto.randomUUID().replace(/-/g,''),name:text,workspace:String(workspace)});
    save(d);
  }
  function projectName(id){
    const d=read();const p=d.projects.find(x=>x.id===d.assignments[id]);
    return p?.name||'';
  }
  function el(tag,cls,text){
    const out=document.createElement(tag);
    if(cls)out.className=cls;
    if(text!==undefined)out.textContent=text;
    return out;
  }
  function attach(deps){
    if(document.getElementById('organizerBtn'))return;
    changed=deps.refresh;
    const button=el('button','btn btn-ghost organizer-trigger','Proyectos y sincronización');
    button.type='button';button.id='organizerBtn';
    const bar=document.getElementById('sessionPanel');
    bar.parentNode.insertBefore(button,bar);
    const dialog=el('dialog','organizer-dialog');
    dialog.id='organizerDialog';
    const area=el('div','organizer-content');
    const title=el('h2',null,'Organización y copia cifrada');
    const message=el('p','muted','Tus datos locales no se borran automáticamente. Solo se sincronizan proyectos, asignaciones, nombres y chats fijados; nunca tokens, borradores ni conversaciones.');
    const newRow=el('div','organizer-actions');
    const projectInput=el('input');projectInput.placeholder='Nombre de proyecto';projectInput.maxLength=64;projectInput.setAttribute('aria-label','Nombre del proyecto');
    const add=el('button','btn btn-ghost','Crear proyecto');add.type='button';
    newRow.append(projectInput,add);
    const projects=el('ul','organizer-projects');
    const syncTitle=el('h3',null,'Copia cifrada entre dispositivos');
    const help=el('p','muted','Una frase ASCII de 12–128 caracteres cifra los datos en este dispositivo. No se envía al servidor. Guardala: sin ella no es posible recuperar la copia. Solo funciona en HTTPS o localhost.');
    const pass1=el('input');pass1.type='password';pass1.placeholder='Frase de cifrado';pass1.autocomplete='off';pass1.setAttribute('aria-label','Frase de cifrado');
    const pass2=el('input');pass2.type='password';pass2.placeholder='Repetir frase para subir';pass2.autocomplete='off';pass2.setAttribute('aria-label','Repetir frase');
    const syncActions=el('div','organizer-actions');
    const upload=el('button','btn btn-primary','Subir copia cifrada');upload.type='button';
    const download=el('button','btn btn-ghost','Previsualizar copia');download.type='button';
    syncActions.append(upload,download);
    const remotePreview=el('div','organizer-preview');
    const status=el('p','muted');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const done=el('button','btn btn-ghost','Cerrar');done.type='button';
    area.append(title,message,newRow,projects,syncTitle,help,pass1,pass2,
      syncActions,remotePreview,status,done);dialog.append(area);document.body.append(dialog);
    let pending=null;
    function clearSecrets(){
      pending=null;pass1.value='';pass2.value='';remotePreview.replaceChildren();
    }
    function close(){
      clearSecrets();dialog.close();
    }
    dialog.addEventListener('close',clearSecrets);done.addEventListener('click',close);
    button.addEventListener('click',()=>{renderProjects();status.textContent='';dialog.showModal();projectInput.focus();});
    function renderProjects(){
      projects.replaceChildren();
      const d=read();
      for(const p of d.projects){
        const li=el('li',null,p.name+(p.workspace?' · '+p.workspace:''));
        projects.append(li);
      }
      if(!d.projects.length)projects.append(el('li','muted','Aún no hay proyectos locales.'));
    }
    add.addEventListener('click',()=>{
      try{addProject(projectInput.value);projectInput.value='';renderProjects();
        status.textContent='Proyecto creado en este dispositivo.';}
      catch(e){status.textContent=e.message;}
    });
    async function request(path,options={}){
      const r=await fetch('/api/organizer-sync',{...options,headers:{
        authorization:'Bearer '+deps.token(),
        ...(options.body?{'content-type':'application/json'}:{})
      }});
      const result=await r.json();
      if(!result.ok){
        if(r.status===409)throw Error('Conflicto de revisión: otro dispositivo actualizó la copia. Descargala y revisá los cambios.');
        throw Error(result.error||'Error de copia cifrada');
      }
      return result;
    }
    function busy(on){upload.disabled=download.disabled=on;}
    upload.addEventListener('click',async()=>{
      status.textContent='';remotePreview.replaceChildren();pending=null;
      if(pass1.value!==pass2.value){status.textContent='Las frases no coinciden.';return;}
      try{
        MuseCrypto().checkPassword(pass1.value);
        busy(true);
        const current=await request();
        if(current.envelope && !window.confirm('Esto reemplazará la copia cifrada anterior del servidor. Los demás dispositivos conservan sus datos locales. ¿Continuar?'))return;
        const envelope=await MuseCrypto().encrypt(read(),pass1.value);
        const result=await request('',{method:'PUT',body:JSON.stringify({
          expectedRevision:current.revision,envelope
        })});
        status.textContent='Copia cifrada publicada (revisión '+result.revision+').';
        clearSecrets();
      }catch(e){status.textContent=e.message||'No se pudo cifrar la copia.';}
      finally{busy(false);}
    });
    download.addEventListener('click',async()=>{
      status.textContent='';remotePreview.replaceChildren();pending=null;
      try{
        MuseCrypto().checkPassword(pass1.value);busy(true);
        const res=await request();
        if(!res.envelope){status.textContent='Todavía no hay copia en el servidor.';return;}
        const data=await MuseCrypto().decrypt(res.envelope,pass1.value);
        pending=data;const own=read();
        const label=el('p','muted','Copia descifrada: '+data.projects.length+
          ' proyectos, '+data.pinned.length+' fijados y '+Object.keys(data.aliases).length+
          ' nombres. Local: '+own.projects.length+' proyectos y '+own.pinned.length+' fijados.');
        const option=el('label','organizer-option');
        const preferRemote=el('input');preferRemote.type='checkbox';
        option.append(preferRemote,document.createTextNode('Preferir datos remotos cuando haya conflictos'));
        const apply=el('button','btn btn-primary','Confirmar importación y combinar');
        apply.type='button';
        apply.addEventListener('click',()=>{
          if(!pending)return;
          try{
            const merged=MuseCrypto().merge(read(),pending,preferRemote.checked);
            save(merged);status.textContent='Combinación aplicada. Los elementos no compartidos permanecen.';
            clearSecrets();renderProjects();
          }catch(e){status.textContent=e.message;}
        });
        remotePreview.append(label,option,apply);
        status.textContent='Revisá los conteos y confirmá la importación. Nada se aplicó todavía.';
        pass1.value='';pass2.value='';
      }catch(e){status.textContent=e.message||'Error de descifrado.';}
      finally{busy(false);}
    });
    return {close};
  }
  function makeSessionControls(session){
    const holder=el('div','organizer-session-tools');
    const pin=el('button','icon-btn',isPinned(session.sessionId)?'★':'☆');
    pin.type='button';pin.title=isPinned(session.sessionId)?'Desfijar':'Fijar';
    pin.setAttribute('aria-label',pin.title);
    pin.addEventListener('click',()=>togglePin(session.sessionId));
    const rename=el('button','icon-btn','✎');
    rename.type='button';rename.title='Renombrar localmente';
    rename.setAttribute('aria-label','Renombrar chat');
    rename.addEventListener('click',()=>{
      const value=window.prompt('Nombre local del chat (vacío restaura)',alias(session.sessionId)||session.name||'');
      if(value===null)return;
      try{setAlias(session.sessionId,value);}catch(e){window.alert(e.message);}
    });
    const select=el('select','organizer-project-select');
    select.setAttribute('aria-label','Asignar chat a proyecto');
    const data=read();
    const none=el('option',null,'Sin proyecto');none.value='';
    select.append(none);
    for(const project of data.projects){
      const opt=el('option',null,project.name);opt.value=project.id;select.append(opt);
    }
    select.value=data.assignments[session.sessionId]||'';
    select.addEventListener('change',()=>setAssignment(session.sessionId,select.value));
    holder.append(pin,rename,select);
    return holder;
  }
  return {read,save,alias,isPinned,projectName,makeSessionControls,attach,
    togglePin,setAlias,setAssignment,addProject};
});
