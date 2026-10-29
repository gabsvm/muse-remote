'use strict';
/**
 * Explicit, bounded cross-session content search.
 * No AI calls. No persistent index, localStorage, IndexedDB or third-party requests.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) root.MuseGlobalSearch = api;
})(typeof window === 'undefined' ? null : window, function() {
  const MAX_SESSIONS = 30;
  const MAX_RESULTS = 80;
  const PER_SESSION = 5;
  function normalized(s) {
    return String(s || '').normalize('NFKC').toLocaleLowerCase().trim();
  }
  function transcriptItems(history) {
    if (!history) return [];
    if (Array.isArray(history.items)) return history.items;
    const state = history.snapshot && history.snapshot.state;
    return state && Array.isArray(state.items) ? state.items : [];
  }
  function excerpt(raw, query) {
    const text = String(raw || '');
    const at = normalized(text).indexOf(normalized(query));
    if (at < 0) return null;
    const from = Math.max(0, at - 65);
    const limit = 220;
    return (from ? '…' : '') + text.slice(from, from + limit).replace(/\s+/g, ' ').trim() +
      (from + limit < text.length ? '…' : '');
  }
  function hitsFromSession(session, history, query) {
    const hits = [];
    for (const item of transcriptItems(history)) {
      if (hits.length >= PER_SESSION) break;
      if (!item || !['userMessage', 'agentMessage'].includes(item.kind)) continue;
      // Avoid tool payloads, reasoning, attachments and excessively large content.
      if (typeof item.text !== 'string' || item.text.length > 250000) continue;
      const found = excerpt(item.text, query);
      if (!found) continue;
      hits.push({
        sessionId: session.sessionId,
        title: String(session.name || session.firstUserPrompt || session.sessionId).slice(0, 100),
        itemId: String(item.itemId || '').slice(0, 100),
        kind: item.kind,
        excerpt: found,
      });
    }
    return hits;
  }
  function pickSessions(sessions, opts) {
    const o = opts || {};
    const hidden = new Set(o.hidden || []);
    const seen = new Set();
    const max = Math.min(MAX_SESSIONS, Math.max(1, Math.floor(Number(o.max) || MAX_SESSIONS)));
    return (Array.isArray(sessions) ? sessions : [])
      .filter(s => {
        const id = s && s.sessionId;
        if (typeof id !== 'string' || !id || seen.has(id)) return false;
        seen.add(id);
        return (o.includeHidden || !hidden.has(id)) && Number(s.turnCount) !== 0;
      })
      .sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0,max);
  }
  async function scan(args) {
    const a = args || {};
    const needle = normalized(a.query).slice(0, 90);
    if (needle.length < 3) throw new Error('Escribí al menos 3 caracteres.');
    if (typeof a.readSession !== 'function') throw new Error('Falta acceso de lectura.');
    const rows = pickSessions(a.sessions, {hidden:a.hidden, includeHidden:a.includeHidden});
    let next=0, done=0, failed=0;
    const hits=[];
    async function work() {
      while (!a.signal?.aborted && next < rows.length && hits.length < MAX_RESULTS) {
        const row=rows[next++];
        try {
          const res=await a.readSession(row.sessionId, a.signal);
          if (a.signal?.aborted) break;
          hits.push(...hitsFromSession(row, res && res.history, needle).slice(
            0, Math.max(0, MAX_RESULTS - hits.length)));
        } catch (error) {
          if (a.signal?.aborted) break;
          failed++;
        }
        done++;
        if (!a.signal?.aborted && typeof a.onProgress==='function') {
          a.onProgress({done, total:rows.length, found:hits.length, failed});
        }
      }
    }
    await Promise.all([work(), work()]);
    return {results:hits.slice(0,MAX_RESULTS),done,total:rows.length,failed,cancelled:!!a.signal?.aborted};
  }
  function attach(deps) {
    const doc=window.document;
    const search=doc.getElementById('searchInput');
    if (!search || doc.getElementById('globalSearchBtn')) return;
    const trigger=doc.createElement('button');
    trigger.id='globalSearchBtn';
    trigger.type='button';
    trigger.className='btn btn-ghost global-search-trigger';
    trigger.textContent='Buscar en mensajes';
    search.closest('.search').insertAdjacentElement('afterend',trigger);
    const dialog=doc.createElement('dialog');
    dialog.id='globalSearchDialog';
    dialog.className='global-search-dialog';
    dialog.setAttribute('aria-labelledby','globalSearchTitle');
    const host=doc.createElement('div');
    host.className='global-search-content';
    const title=doc.createElement('h2');
    title.id='globalSearchTitle';
    title.textContent='Buscar en conversaciones';
    const note=doc.createElement('p');
    note.className='muted';
    note.textContent='Examina hasta 30 chats recientes cargados. Solo lectura, sin guardar índice ni consumir cuota de modelos.';
    const input=doc.createElement('input');
    input.type='search';input.maxLength=90;input.autocomplete='off';
    input.placeholder='Texto (mínimo 3 caracteres)';
    input.setAttribute('aria-label','Texto para buscar en mensajes');
    const label=doc.createElement('label'); label.className='global-search-option';
    const includeHidden=doc.createElement('input');includeHidden.type='checkbox';
    label.append(includeHidden, doc.createTextNode('Incluir conversaciones ocultas'));
    const actions=doc.createElement('div');actions.className='global-search-actions';
    const start=doc.createElement('button');start.type='button';start.className='btn btn-primary';start.textContent='Buscar';
    const cancel=doc.createElement('button');cancel.type='button';cancel.className='btn btn-ghost';cancel.textContent='Cerrar';
    actions.append(start,cancel);
    const status=doc.createElement('p');status.className='muted';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const results=doc.createElement('ul');results.className='global-search-results';
    host.append(title,note,input,label,actions,status,results);dialog.append(host);doc.body.append(dialog);
    let controller=null, seq=0;
    function stop() {
      seq++;if(controller)controller.abort();
      controller=null;start.disabled=false;start.textContent='Buscar';
    }
    function purge() {
      results.replaceChildren();
      input.value='';
      includeHidden.checked=false;
      status.textContent='';
    }
    function close() {stop();purge();dialog.close();}
    trigger.addEventListener('click',()=> {
      if(!deps.listSessions()?.length){status.textContent='Actualizá la lista de sesiones para buscar.';}
      dialog.showModal();input.focus();
    });
    cancel.addEventListener('click',()=>{
      if(controller){stop();status.textContent='Búsqueda cancelada.';}
      else close();
    });
    dialog.addEventListener('close',()=>{stop();purge();});
    dialog.addEventListener('cancel', stop);
    input.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();start.click();}
    });
    start.addEventListener('click',async()=>{
      if(input.value.trim().length<3){status.textContent='Escribí al menos 3 caracteres.';input.focus();return;}
      if(!deps.listSessions()?.length){status.textContent='Primero actualizá las sesiones.';return;}
      stop();
      const current=seq;
      controller=new AbortController();
      const signal=controller.signal;
      start.disabled=true;start.textContent='Buscando…';
      results.replaceChildren();
      status.textContent='Consultando historial disponible…';
      try{
        const found=await scan({
          sessions:deps.listSessions(),
          hidden:deps.hiddenIds(),
          includeHidden:includeHidden.checked,
          query:input.value,
          readSession:deps.readSession,
          signal,
          onProgress:p=>{
            if(seq===current)status.textContent='Revisados '+p.done+'/'+p.total+' chats · '+p.found+' coincidencias'+
              (p.failed?' · '+p.failed+' errores':'');
          },
        });
        if(current!==seq || signal.aborted)return;
        status.textContent='Encontradas '+found.results.length+' coincidencias en '+found.done+'/'+found.total+
          ' chats'+(found.failed?' ('+found.failed+' errores de lectura)':'')+
          '. No incluye historial fuera de session/read.';
        for(const hit of found.results){
          const li=doc.createElement('li');
          const btn=doc.createElement('button');btn.type='button';btn.className='global-search-hit';
          const name=doc.createElement('strong');name.textContent=hit.title;
          const speaker=doc.createElement('small');speaker.textContent=hit.kind==='userMessage'?'Tu mensaje':'Muse';
          const preview=doc.createElement('p');preview.textContent=hit.excerpt;
          btn.append(name,speaker,preview);
          btn.addEventListener('click',()=>{close();deps.openSession(hit.sessionId);});
          li.append(btn);results.append(li);
        }
        if(!found.results.length){
          const empty=doc.createElement('li');empty.textContent='Sin coincidencias en las sesiones examinadas.';results.append(empty);
        }
      }catch(e){if(seq===current)status.textContent=e.message||'Error de búsqueda.';}
      finally{if(seq===current){controller=null;start.disabled=false;start.textContent='Buscar';}}
    });
    return {close,stop};
  }
  return {transcriptItems, excerpt,hitsFromSession,pickSessions,scan,attach};
});
