'use strict';
// Cliente PWA: habla solo con este backend (mismo origen). Sin API keys.
const CLIENT_MAX_IMAGE_DIM = 1568; // lado mayor max del JPEG generado
const CLIENT_MAX_IMAGE_BASE64_CHARS = 4 * 1024 * 1024; // ~3 MiB binarios
const CLIENT_MAX_RPC_BYTES = 5 * 1024 * 1024; // espejo del limite del servidor
function imageBase64TooLarge(b64) {
  return typeof b64 === 'string' && b64.length > CLIENT_MAX_IMAGE_BASE64_CHARS;
}
const $ = (id) => document.getElementById(id);
const state = {
  token: localStorage.getItem('muse-remote-token') || '',
  sessionId: null,
  viewCursor: null,
  es: null,
  running: false,
  items: new Map(), // itemId -> {kind, text, ...}
  turnId: null,
  queuedTurnId: null,
  pendingImage: null, // {base64Data, mediaType, width, height}
  showSys: false,
  showHidden: false,
  listTab: 'chats', // chats | empty
};
function loadHidden() {
  try { return JSON.parse(localStorage.getItem('muse-remote-hidden') || '[]'); }
  catch { return []; }
}
function saveHidden(ids) {
  try { localStorage.setItem('muse-remote-hidden', JSON.stringify(ids)); } catch {}
}
function isHidden(id) { return loadHidden().includes(id); }

async function rpc(method, params) {
  const r = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.token },
    body: JSON.stringify({ method, params }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || ('rpc ' + r.status));
  return j.result;
}
async function newCommandId() {
  const r = await fetch('/api/command-id', { headers: { authorization: 'Bearer ' + state.token } });
  const j = await r.json();
  return j.commandId;
}
function show(name) {
  for (const v of ['loginView', 'sessionsView', 'chatView']) $(v).classList.add('hidden');
  $(name).classList.remove('hidden');
}
function setConn(on) {
  const c = $('conn');
  c.dataset.state = on ? 'on' : 'off';
  c.textContent = on ? 'on' : 'off';
}
function setStatus(s) {
  const b = $('statusBadge');
  b.dataset.state = s;
  b.textContent = s;
}

// ---- login ----
async function tryLogin(token) {
  const r = await fetch('/api/health');
  if (!r.ok) throw new Error('backend no disponible');
  // health es publica; validar token con una llamada barata
  const t = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ method: 'model/list', params: {} }),
  });
  if (t.status === 401) throw new Error('token incorrecto');
  const j = await t.json();
  if (!j.ok) throw new Error(j.error || 'error MSP');
  return j.result;
}

// ---- sesiones ----
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function fmtRel(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return fmtDate(iso);
}
function isEmptySession(s) {
  return !s || ((s.turnCount || 0) === 0 && !((s.firstUserPrompt || s.name) || '').toString().trim());
}
// Actividad primero (por updatedAt), vacías al final.
function sortSessions(list) {
  const arr = (list || []).slice();
  const ts = (s) => Date.parse(s.updatedAt || s.createdAt || 0) || 0;
  arr.sort((a, b) => {
    const ea = isEmptySession(a) ? 1 : 0;
    const eb = isEmptySession(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return ts(b) - ts(a);
  });
  return arr;
}
function sessTitle(s) {
  const t = (s.name || s.firstUserPrompt || '').toString().trim().replace(/\s*\[Image #\d+\]/g, '').trim();
  if (t) return t.slice(0, 100);
  return 'Sesión ' + String(s.sessionId || '').slice(0, 8) + '…';
}
function turnos(n) {
  const c = n || 0;
  return `${c} turno${c === 1 ? '' : 's'}`;
}
// "Ventana 34% · queda 66% · se libera hoy 15:15". Datos point-in-time.
function usageLine(block, label) {
  if (!block || block.usedPercent === undefined || block.usedPercent === null) return null;
  const used = block.usedPercent;
  const left = 100 - used;
  let reset = '';
  if (block.resetsAtMs) {
    try {
      const d = new Date(block.resetsAtMs);
      const sameDay = new Date().toDateString() === d.toDateString();
      const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      reset = sameDay ? ` · se libera hoy ${hh}` : ` · se libera ${d.toLocaleDateString()} ${hh}`;
    } catch {}
  }
  return `${label} ${used}% · queda ${left}%${reset}`;
}
function sessMeta(s) {
  const parts = [s.status || ''];
  parts.push(s.modelId || 'modelo?');
  if (s.turnCount !== undefined && s.turnCount !== null) parts.push(s.turnCount + ' turnos');
  const when = fmtDate(s.updatedAt || s.createdAt);
  if (when) parts.push(when);
  if (s.workspaceRoot) {
    const w = String(s.workspaceRoot).split(/[/\\]/).filter(Boolean).pop();
    if (w) parts.push(w);
  }
  return parts.join(' · ');
}
async function loadSessions() {
  const ul = $('sessionList');
  ul.innerHTML = '<li class="loading">Cargando sesiones… (la primera vez tarda)</li>';
  let res;
  try {
    res = await rpc('session/list', { limit: 50 });
  } catch (e) {
    ul.innerHTML = '';
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Error: ' + e.message + ' — toca para reintentar';
    b.addEventListener('click', loadSessions);
    li.append(b);
    ul.append(li);
    toast('No se pudo listar sesiones: ' + e.message);
    return [];
  }
  ul.innerHTML = '';
  const hidden = loadHidden();
  let nHidden = 0;
  const rows = sortSessions(res.sessions || []);
  const visible = rows.filter((s) => {
    if (hidden.includes(s.sessionId) && !state.showHidden) { nHidden++; return false; }
    return true;
  });
  const nEmptyAll = visible.filter(isEmptySession).length;
  const nChatsAll = visible.length - nEmptyAll;
  const tc = $('tabChats');
  const te = $('tabEmpty');
  if (tc) { tc.textContent = `Chats (${nChatsAll})`; tc.setAttribute('aria-selected', state.listTab === 'chats' ? 'true' : 'false'); }
  if (te) { te.textContent = `Vacías (${nEmptyAll})`; te.setAttribute('aria-selected', state.listTab === 'empty' ? 'true' : 'false'); }
  for (const s of visible) {
    const hid = hidden.includes(s.sessionId);
    const empty = isEmptySession(s);
    if (state.listTab === 'chats' && empty) continue;
    if (state.listTab === 'empty' && !empty) continue;
    const li = document.createElement('li');
    li.className = 'sess-card';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sess-open';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.status = s.status || '';
    const tt = document.createElement('div');
    tt.className = 'sess-title';
    tt.textContent = (hid ? '[oculta] ' : '') + sessTitle(s);
    const m = document.createElement('div');
    m.className = 'sid';
    m.textContent = `${s.status || ''} · ${s.modelId || 'modelo?'} · ${turnos(s.turnCount)} · ${fmtRel(s.updatedAt || s.createdAt)}`;
    const txt = document.createElement('div');
    txt.className = 'sess-txt';
    txt.append(tt, m);
    b.append(dot, txt);
    b.addEventListener('click', () => openSession(s.sessionId, b));
    li.append(b);
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'ghost sess-hide';
    h.textContent = hid ? 'Mostrar' : 'Ocultar';
    h.addEventListener('click', () => {
      const ids = loadHidden();
      if (hid) saveHidden(ids.filter((x) => x !== s.sessionId));
      else { ids.push(s.sessionId); saveHidden(ids); }
      loadSessions();
    });
    li.append(h);
    ul.append(li);
  }
  const hb = $('hiddenBtn');
  if (hb) hb.textContent = state.showHidden ? 'Ocultas: sí' : ('Ocultas' + (nHidden ? ` (${nHidden})` : ''));
  if (!ul.children.length) {
    ul.innerHTML = state.listTab === 'empty'
      ? '<li class="muted">Sin sesiones vacías. Todo limpio.</li>'
      : '<li class="muted">Sin sesiones. Crea una con “Nueva”.</li>';
  }
  return res.sessions || [];
}

async function openSession(sessionId, btn) {
  const orig = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<div>Abriendo…</div>'; }
  try {
    const res = await rpc('session/resume', { commandId: await newCommandId(), sessionId });
    try { localStorage.setItem('muse-remote-session', sessionId); } catch {}
    state.sessionId = sessionId;
    state.items.clear();
    $('transcript').innerHTML = '';
    $('approvals').innerHTML = '';
    show('chatView');
    state.viewCursor = res.viewCursor || null;
    $('wsLine').textContent = (res.session && res.session.workspaceRoot)
      ? 'Carpeta: ' + res.session.workspaceRoot
      : 'Sin carpeta de trabajo (sin acceso a archivos)';
    renderHistory(res.history);
    setStatus(res.session && res.session.status === 'running' ? 'running' : 'idle');
    await refreshModels(res.session);
    await refreshApproval(res.session);
    await refreshSkills();
    await refreshPending();
    connectEvents();
  } catch (e) {
    toast('No se pudo abrir la sesión: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; if (orig !== null) btn.innerHTML = orig; }
  }
}

function renderHistory(history) {
  if (!history) return;
  // session/resume devuelve Items directos (history.items), no eventos view.
  for (const item of history.items || []) {
    if (item && item.itemId) {
      state.items.set(item.itemId, item);
      renderItem(item);
      if (item.viewCursor) state.viewCursor = item.viewCursor;
    }
  }
  // view/page sí devuelve notificaciones {method, params}.
  for (const ev of history.events || []) {
    if (ev && ev.method) applyViewEvent(ev.method, ev.params || ev);
  }
}

function textOf(item) {
  if (!item) return '';
  if (typeof item.text === 'string') return item.text;
  if (Array.isArray(item.summary)) return item.summary.join('\n');
  if (typeof item.output === 'string') return item.output;
  if (typeof item.displayText === 'string') return item.displayText;
  return '';
}

function renderItem(item) {
  const li = document.querySelector(`li[data-item="${CSS.escape(item.itemId || '')}"]`);
  const kind = item.kind || 'message';
  const host = li || document.createElement('li');
  host.className = 'msg';
  host.dataset.kind = kind;
  if (item.itemId) host.dataset.item = item.itemId;
  host.innerHTML = '';
  const k = document.createElement('span');
  k.className = 'kind';
  k.textContent = labelFor(item);
  host.append(k);
  const body = document.createElement('div');
  const t = textOf(item);
  if (t) body.textContent = t;
  if (item.toolName || item.args) {
    const pre = document.createElement('pre');
    pre.textContent = (item.toolName || '') + (item.args ? ' ' + String(item.args).slice(0, 2000) : '');
    body.append(pre);
  }
  if ((item.kind === 'subagent' || item.kind === 'reminderChild') && (item.childSessionId || item.agentPath || item.reminderAgentId || item.fallbackText)) {
    const pre = document.createElement('pre');
    pre.textContent = `hijo ${item.reminderAgentId || item.agentPath || ''} ${item.status || ''} ${item.fallbackText || ''} ${item.childSessionId || ''}`.trim();
    body.append(pre);
  }
  if (item.kind === 'workflow' && Array.isArray(item.children)) {
    const pre = document.createElement('pre');
    pre.textContent = item.children.map((c) => `${c.childId || c.id || '?'}: ${c.status || c.state || ''}`).join('\n');
    body.append(pre);
  }
  if (!body.textContent) {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(item, null, 1).slice(0, 1500);
    body.append(pre);
  }
  host.append(body);
  const acts = document.createElement('div');
  acts.className = 'btns';
  acts.style.cssText = 'display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap';
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost';
    b.style.minHeight = '36px';
    b.style.padding = '.3rem .6rem';
    b.style.fontSize = '.85rem';
    b.textContent = label;
    b.addEventListener('click', fn);
    acts.append(b);
  };
  if (item.outputRef) {
    mkBtn('Ver completo', async () => {
      try {
        const r = await rpc('item/readOutput', { itemId: item.itemId });
        const pre = document.createElement('pre');
        pre.textContent = String((r && (r.output || r.text)) || JSON.stringify(r).slice(0, 6000));
        body.append(pre);
      } catch (e) { toast('Error: ' + e.message); }
    });
  }
  if (item.kind === 'subagent' && item.subagentId) {
    const sid = item.subagentId;
    mkBtn('Mensaje', async () => {
      const t = prompt('Mensaje al subagente');
      if (!t) return;
      try { await rpc('subagent/sendMessage', { commandId: await newCommandId(), sessionId: state.sessionId, subagentId: sid, body: t }); }
      catch (e) { toast('Error: ' + e.message); }
    });
    mkBtn('Seguir', async () => {
      const t = prompt('Tarea de seguimiento');
      if (!t) return;
      try { await rpc('subagent/followupTask', { commandId: await newCommandId(), sessionId: state.sessionId, subagentId: sid, body: t }); }
      catch (e) { toast('Error: ' + e.message); }
    });
    mkBtn('Detener', async () => {
      if (!confirm('¿Detener subagente?')) return;
      try { await rpc('subagent/stop', { commandId: await newCommandId(), sessionId: state.sessionId, subagentId: sid }); }
      catch (e) { toast('Error: ' + e.message); }
    });
  }
  if (item.kind === 'toolCall' && item.itemId) {
    const tid = item.itemId;
    mkBtn('A fondo', async () => {
      try { await rpc('task/background', { commandId: await newCommandId(), sessionId: state.sessionId, taskId: tid }); }
      catch (e) { toast('Error: ' + e.message); }
    });
    mkBtn('Detener tarea', async () => {
      try { await rpc('task/stop', { commandId: await newCommandId(), sessionId: state.sessionId, taskId: tid }); }
      catch (e) { toast('Error: ' + e.message); }
    });
  }
  if (acts.children.length) host.append(acts);
  if (!li) $('transcript').append(host);
  // Hijos internos del sistema (reminderChild): ocultos salvo toggle.
  if (item.kind === 'reminderChild' && !state.showSys) host.style.display = 'none';
  else host.style.display = '';
  updateSysBtn();
  host.scrollIntoView({ block: 'nearest' });
}
function updateSysBtn() {
  const b = $('sysBtn');
  if (!b) return;
  let n = 0;
  for (const li of document.querySelectorAll('#transcript li')) {
    if (li.style.display === 'none') n++;
  }
  b.textContent = state.showSys ? 'Sistema: sí' : ('Sistema' + (n ? ` (${n})` : ''));
}

function labelFor(item) {
  const base = item.kind || 'mensaje';
  if (item.kind === 'toolCall') return `tool · ${item.toolName || item.callId || ''} · ${item.status || ''}`.trim();
  if (item.status) return `${base} · ${item.status}`;
  return base;
}

function applyViewEvent(method, p) {
  if (!p) return;
  if (p.viewCursor) state.viewCursor = p.viewCursor;
  switch (method) {
    case 'item/started':
    case 'item/updated':
    case 'item/completed':
      if (p.item) { state.items.set(p.item.itemId, p.item); renderItem(p.item); }
      break;
    case 'item/delta': {
      const cur = state.items.get(p.itemId) || { itemId: p.itemId, kind: 'agentMessage', text: '' };
      const field = p.field || 'text';
      if (field === 'text' || field.startsWith('summary')) cur.text = (cur.text || '') + (p.delta || '');
      else cur[field] = (cur[field] || '') + (p.delta || '');
      state.items.set(p.itemId, cur);
      renderItem(cur);
      break;
    }
    case 'turn/started':
      state.running = true; state.turnId = p.turnId || null; setStatus('running');
      break;
    case 'turn/completed':
    case 'turn/retracted':
    case 'turn/unqueued':
      state.running = false; setStatus(pendingCount() ? 'waiting' : 'idle');
      break;
    case 'session/statusChanged':
      setStatus(liveStatus(p));
      break;
    case 'approval/requested':
    case 'approval/request':
      setStatus('waiting'); renderApproval(p);
      break;
    case 'approval/resolved':
      removeApproval(p.approvalId); setStatus(state.running ? 'running' : 'idle');
      break;
    case 'userInput/requested':
    case 'userInput/request':
      setStatus('waiting'); renderUserInput(p);
      break;
    case 'userInput/settled':
      setStatus(state.running ? 'running' : 'idle');
      break;
    case 'session/modelChanged':
      if (p.modelId) $('modelSel').value = p.modelId;
      break;
    case 'session/approvalModeChanged':
      if (p.mode) $('approvalSel').value = p.mode;
      break;
    default:
      break;
  }
}
function pendingCount() { return $('approvals').children.length; }
function liveStatus(p) {
  if ((p.attention && p.attention.length) || (p.pendingRequests && p.pendingRequests.length)) return 'waiting';
  return p.status === 'running' ? 'running' : 'idle';
}

// ---- approvals ----
function renderApproval(p) {
  if (!p || !p.approvalId || document.querySelector(`[data-appr="${CSS.escape(p.approvalId)}"]`)) return;
  const div = document.createElement('div');
  div.className = 'approval';
  div.dataset.appr = p.approvalId;
  const title = document.createElement('strong');
  title.textContent = `Approval · ${p.toolName || (p.subject && p.subject.kind) || ''}`;
  const desc = document.createElement('div');
  desc.className = 'muted';
  desc.textContent = (p.subject && (p.subject.command || p.subject.path || p.rawArgs)) || p.rawArgs || '';
  const btns = document.createElement('div');
  btns.className = 'btns';
  for (const c of p.availableChoices || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.label || c.choiceId;
    b.addEventListener('click', () => decideApproval(p, c.choiceId));
    btns.append(b);
  }
  div.append(title, desc, btns);
  $('approvals').append(div);
}
async function decideApproval(p, choiceId) {
  try {
    await rpc('approval/decide', {
      approvalId: p.approvalId, choiceId, commandId: await newCommandId(),
      requirementId: p.currentRequirementId, sessionId: state.sessionId,
    });
  } catch (e) { alert('Error: ' + e.message); }
}
function removeApproval(id) {
  const el = document.querySelector(`[data-appr="${CSS.escape(id || '')}"]`);
  if (el) el.remove();
}
function renderUserInput(p) {
  if (!p || !p.userInputId || document.querySelector(`[data-ui="${CSS.escape(p.userInputId)}"]`)) return;
  const div = document.createElement('div');
  div.className = 'approval';
  div.dataset.ui = p.userInputId;
  const t = document.createElement('strong');
  t.textContent = 'El modelo pregunta' + (p.toolName ? ` · ${p.toolName}` : '');
  div.append(t);
  const answers = [];
  for (const q of p.questions || []) {
    const box = document.createElement('div');
    box.style.marginTop = '.5rem';
    const h = document.createElement('div');
    h.textContent = (q.header ? q.header + ': ' : '') + (q.question || '');
    box.append(h);
    const sel = q.selection || {};
    const mode = sel.mode === 'multiple' ? 'multiple' : 'single';
    const picked = { mode, inputs: [] };
    for (const o of q.options || []) {
      const lab = document.createElement('label');
      lab.style.display = 'flex';
      lab.style.gap = '.4rem';
      lab.style.alignItems = 'center';
      const inp = document.createElement('input');
      inp.type = mode === 'multiple' ? 'checkbox' : 'radio';
      inp.name = 'q_' + q.id;
      inp.value = o.label;
      inp.style.width = 'auto';
      picked.inputs.push(inp);
      const span = document.createElement('span');
      span.textContent = o.label + (o.description ? ' — ' + o.description : '');
      lab.append(inp, span);
      box.append(lab);
    }
    const free = document.createElement('input');
    free.placeholder = 'O escribe respuesta libre (máx 500)';
    free.maxLength = 500;
    box.append(free);
    div.append(box);
    answers.push({ q, picked, free });
  }
  const note = document.createElement('input');
  note.placeholder = 'Nota opcional (máx 500)';
  note.maxLength = 500;
  div.append(note);
  const btns = document.createElement('div');
  btns.className = 'btns';
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = 'Responder';
  send.addEventListener('click', async () => {
    try {
      const out = [];
      for (const a of answers) {
        const sel = a.picked.inputs.filter((i) => i.checked).map((i) => i.value);
        const entry = { questionId: a.q.id };
        if (sel.length) {
          if (a.picked.mode === 'multiple') {
            const min = (a.q.selection && a.q.selection.minSelections) || 0;
            const max = (a.q.selection && a.q.selection.maxSelections) || sel.length;
            if (sel.length < min || sel.length > max) throw new Error(`"${a.q.id}": elige entre ${min} y ${max}`);
            entry.selectedLabels = sel;
          } else {
            entry.selectedLabel = sel[0];
          }
        } else if (a.free.value.trim()) {
          entry.freeText = a.free.value.trim().slice(0, 500);
        } else {
          throw new Error(`"${a.q.id}": elige una opción o escribe texto`);
        }
        if (note.value.trim()) entry.note = note.value.trim().slice(0, 500);
        out.push(entry);
      }
      await rpc('userInput/answer', {
        userInputId: p.userInputId, answers: out,
        commandId: await newCommandId(), sessionId: state.sessionId,
      });
      div.remove();
      if (!pendingCount()) setStatus(state.running ? 'running' : 'idle');
    } catch (e) { toast('Error: ' + e.message); }
  });
  btns.append(send);
  div.append(btns);
  $('approvals').append(div);
}
async function refreshPending() {
  try {
    const r = await rpc('approval/listPending', { sessionId: state.sessionId });
    for (const a of r.approvals || []) renderApproval(a);
    if ((r.approvals || []).length) setStatus('waiting');
  } catch { /* puede no haber pendientes */ }
}

async function refreshApproval(session) {
  const sel = $('approvalSel');
  const mode = (session && session.approvalMode && session.approvalMode.mode) || '';
  if (mode) sel.value = mode;
  else sel.selectedIndex = 0;
}
async function refreshSkills() {
  const sel = $('skillSel');
  try {
    const r = await rpc('skill/list', { sessionId: state.sessionId });
    sel.innerHTML = '<option value="">(ninguna)</option>';
    for (const s of (r && r.skills) || []) {
      const o = document.createElement('option');
      o.value = s.selector || s.name;
      o.textContent = s.displayName || s.selector || s.name;
      o.title = s.description || '';
      sel.append(o);
    }
  } catch { /* skills no disponibles: se envia como texto */ }
}

// ---- modelos / effort ----
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 6000);
}
function fillModelSelect(models, activeId) {
  const sel = $('modelSel');
  sel.innerHTML = '';
  if (!models.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Sin modelos (reintentar al recargar)';
    sel.append(o);
    return;
  }
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m.modelId;
    o.textContent = m.displayLabel || m.modelId;
    sel.append(o);
  }
  if (activeId) sel.value = activeId;
  if (!sel.value && models.length) sel.selectedIndex = 0;
}
async function fetchCatalog() {
  // Con sessionId para marcar el activo; sin el como fallback.
  try {
    if (state.sessionId) {
      const cat = await rpc('model/list', { sessionId: state.sessionId });
      if (cat.models && cat.models.length) return cat;
    }
  } catch (e) { toast('Modelos (sesion): ' + e.message); }
  return rpc('model/list', {});
}
async function refreshModels(session) {
  const sel = $('modelSel');
  if (!sel.options.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Cargando modelos…';
    sel.append(o);
  }
  try {
    const cat = await fetchCatalog();
    const active = (cat.models || []).find((m) => m.isActive) || session;
    fillModelSelect(cat.models || [], active && active.modelId);
  } catch (e) {
    fillModelSelect([], null);
    toast('No se pudo cargar el catalogo: ' + e.message);
  }
}

// ---- SSE con reconexion explicita ----
let esGen = 0;
function noteAlive() { state.lastEventAt = Date.now(); }
function netinfo(msg) {
  const el = $('netinfo');
  if (el) el.textContent = msg || '';
  try { console.debug('[muse-remote] net', msg); } catch {}
}

function setConnDetail(d) {
  const c = $('conn');
  c.title = d || '';
  try { console.debug('[muse-remote] conn', d); } catch {}
}
// Sesion sin vista en vivo (sin sidecar): refresco por polling via session/read.
function enterPollMode(reason) {
  esGen++;
  clearTimeout(state.esRetry);
  if (state.es) { try { state.es.close(); } catch {} state.es = null; }
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  const c = $('conn');
  c.dataset.state = 'waiting';
  c.textContent = 'poll';
  setConnDetail('poll: ' + (reason || 'sin live tail'));
  toast('Sesión sin directo en vivo — actualizando cada 10 s');
  const tick = async () => {
    if (!state.sessionId) return;
    try {
      const res = await rpc('session/read', { sessionId: state.sessionId });
      if (res.viewCursor) state.viewCursor = res.viewCursor;
      renderHistory(res.history);
      if (res.session) {
        setStatus(res.session.status === 'running' ? 'running' : 'idle');
        if (res.session.modelId && $('modelSel').value !== res.session.modelId) {
          try { await refreshModels(res.session); } catch {}
        }
        try { await refreshApproval(res.session); } catch {}
      }
      noteAlive();
    } catch (e) {
      setConnDetail('poll error: ' + e.message);
    }
  };
  tick();
  state.pollTimer = setInterval(tick, 10000);
}
function exitPollMode() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}
function scheduleReconnect(gen, ms) {
  clearTimeout(state.esRetry);
  state.esRetry = setTimeout(() => {
    if (gen === esGen && state.sessionId) connectEvents();
  }, ms);
}
// Parseo SSE manual sobre fetch: el API EventSource falla en algunos
// navegadores aun con HTTP 200 (probado), mientras fetch llega siempre.
function parseFrame(frame) {
  let type = null;
  const data = [];
  for (let line of frame.split('\n')) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('event:')) type = line.slice(6).replace(/^ /, '');
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (type === null) return null;
  return { type, data: data.join('\n') };
}
function streamEvents(url, myGen, handlers, extraHeaders) {
  const ctrl = new AbortController();
  const handle = { closed: false, close() { handle.closed = true; try { ctrl.abort(); } catch {} } };
  (async () => {
    let r;
    try {
      // El token viaja en Authorization: Bearer (fetch si permite
      // cabeceras); nunca en el query string.
      r = await fetch(url, {
        signal: ctrl.signal,
        headers: Object.assign({ Accept: 'text/event-stream' }, extraHeaders || {}),
      });
    } catch (e) {
      if (!handle.closed) handlers.failure('red: ' + (e.name || 'error'));
      return;
    }
    const ct = String((r.headers && r.headers.get('content-type')) || '');
    if (!r.ok || !ct.includes('text/event-stream')) {
      try { r.body && (await r.body.cancel()); } catch {}
      if (!handle.closed) handlers.failure('http ' + r.status);
      return;
    }
    handlers.open();
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = parseFrame(frame);
          if (ev) handlers.event(ev.type, ev.data);
        }
      }
    } catch (e) {
      if (!handle.closed) handlers.failure('stream: ' + (e.name || 'error'));
      return;
    }
    if (!handle.closed) handlers.failure('stream cerrado por el servidor');
  })();
  return handle;
}
function connectEvents() {
  exitPollMode();
  const myGen = ++esGen;
  if (state.es) { try { state.es.close(); } catch {} state.es = null; }
  clearTimeout(state.esRetry);
  state.esRetry = null;
  const q = new URLSearchParams({ sessionId: state.sessionId });
  if (state.viewCursor) q.set('after', state.viewCursor);
  const url = '/api/events?' + q.toString();
  const authHeader = { authorization: 'Bearer ' + state.token };
  const forward = (type, raw) => {
    if (myGen !== esGen) return;
    noteAlive();
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    if (type === 'subscribed') {
      setConn(true); state.esFails = 0; noteAlive();
      netinfo('SSE en vivo' + (state.viewCursor ? ' · cursor ' + state.viewCursor.slice(-12) : ''));
      try { if (d.viewCursor) state.viewCursor = d.viewCursor; } catch {}
      return;
    }
    if (type === 'ping') return; // keepalive ya contado en noteAlive
    if (type === 'error') {
      // Rechazo definitivo del servidor (p. ej. sesion sin sidecar) -> poll.
      enterPollMode(d.error || '');
      return;
    }
    if (type === 'bridge') {
      try { if (d.__bridge === 'host-down') setConn(false); } catch {}
      return;
    }
    applyViewEvent(type, d.params || d);
  };
  const failure = (reason) => {
    if (myGen !== esGen) return;
    if (state.es) { try { state.es.close(); } catch {} state.es = null; }
    setConn(false);
    state.esFails = (state.esFails || 0) + 1;
    const info = reason + ' · intento #' + state.esFails;
    setConnDetail(info);
    netinfo('SSE: ' + info);
    toast('Conexión en vivo perdida — reintentando…');
    scheduleReconnect(myGen, Math.min(30000, 2000 * state.esFails));
  };
  state.es = streamEvents(url, myGen, {
    open: () => { if (myGen === esGen) { setConn(true); state.esFails = 0; } },
    event: forward,
    failure,
  }, authHeader);
}
// Watchdog: si el proxy intermedio mata el stream en silencio, re-suscribe
// gapless con after=cursor (el servidor reemite lo perdido).
const watchdog = setInterval(() => {
  if (state.sessionId && state.lastEventAt && Date.now() - state.lastEventAt > 65000) {
    connectEvents();
  }
}, 10000);
if (watchdog && watchdog.unref) watchdog.unref(); // solo node (tests): no retener el runner

// ---- composer ----
function clearImage() {
  state.pendingImage = null;
  $('fileInput').value = '';
  const pv = $('imgPreview');
  pv.innerHTML = '';
  pv.classList.add('hidden');
}
async function sendPrompt(text) {
  const effort = $('effortSel').value || undefined;
  const ifBusy = $('busySel').value || 'queue';
  const skill = $('skillSel').value || '';
  const parts = [];
  if (skill) parts.push({ type: 'skill', selector: skill, arguments: text });
  else if (text) parts.push({ type: 'text', text });
  if (state.pendingImage) {
    const im = state.pendingImage;
    if (imageBase64TooLarge(im.base64Data)) throw new Error('imagen demasiado grande (máx 4 MiB en base64)');
    parts.push({ type: 'image', base64Data: im.base64Data, mediaType: im.mediaType, width: im.width, height: im.height });
  }
  if (!parts.length) return;
  const params = {
    commandId: await newCommandId(), sessionId: state.sessionId,
    input: parts, ifBusy,
  };
  if (effort) params.reasoningEffort = effort;
  const ack = await rpc('turn/start', params);
  clearImage();
  // Capturar turno encolado para ofrecer Desencolar (ack.turnId != turno live).
  try {
    const tid = ack && (ack.turnId || (ack.turn && ack.turn.turnId));
    const disp = ack && (ack.disposition || (ack.turn && ack.turn.disposition));
    if (tid && (disp === 'queued' || (state.turnId && tid !== state.turnId))) {
      state.queuedTurnId = tid;
      $('unqueueBtn').classList.remove('hidden');
    } else {
      state.queuedTurnId = null;
      $('unqueueBtn').classList.add('hidden');
    }
  } catch {}
  // Un turno nuevo puede materializar la vista en vivo: reintentar salir de poll.
  if ($('conn').textContent === 'poll') connectEvents();
}
function attachImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) { toast('Solo imágenes'); return; }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const scale = Math.min(1, CLIENT_MAX_IMAGE_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataUrl = cv.toDataURL('image/jpeg', 0.85);
    const b64 = dataUrl.split(',')[1] || '';
    if (imageBase64TooLarge(b64)) { toast('Imagen demasiado grande tras comprimir (máx 4 MiB)'); return; }
    state.pendingImage = {
      base64Data: dataUrl.split(',')[1],
      mediaType: 'image/jpeg', width: w, height: h,
    };
    const pv = $('imgPreview');
    pv.innerHTML = '';
    const th = document.createElement('img');
    th.src = dataUrl;
    th.style.cssText = 'max-height:96px;border-radius:10px;border:1px solid var(--line)';
    th.alt = 'imagen adjunta';
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'ghost';
    rm.textContent = 'Quitar';
    rm.addEventListener('click', clearImage);
    pv.append(th, rm);
    pv.classList.remove('hidden');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('No se pudo leer la imagen'); };
  img.src = url;
}

// ---- wiring ----
document.addEventListener('DOMContentLoaded', () => {
  // Share Target de Android (?text/?url/?title) -> prefill del composer.
  try {
    const sq = new URLSearchParams(location.search);
    const shared = [sq.get('title'), sq.get('text'), sq.get('url')].filter(Boolean).join('\n');
    if (shared) {
      const ta = document.getElementById('promptInput');
      if (ta) ta.value = shared;
      history.replaceState(null, '', location.pathname);
    }
  } catch {}
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('muse-remote-theme');
  if (savedTheme) root.dataset.theme = savedTheme;
  $('themeBtn').addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('muse-remote-theme', next);
  });
  if (state.token) { show('sessionsView'); $('logoutBtn').classList.remove('hidden'); boot().catch(() => showLogin()); }
  else showLogin();

  $('loginBtn').addEventListener('click', async () => {
    $('loginErr').textContent = '';
    const tok = $('tokenInput').value.trim();
    if (!tok) { $('loginErr').textContent = 'Falta el token.'; return; }
    try {
      state.token = tok;
      await tryLogin(tok);
      localStorage.setItem('muse-remote-token', tok);
      $('logoutBtn').classList.remove('hidden');
      show('sessionsView');
      await boot();
    } catch (e) { $('loginErr').textContent = e.message; }
  });
  $('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('muse-remote-token');
    try { localStorage.removeItem('muse-remote-session'); } catch {}
    state.token = '';
    esGen++;
    exitPollMode();
    clearTimeout(state.esRetry);
    if (state.es) { try { state.es.close(); } catch {} state.es = null; }
    $('logoutBtn').classList.add('hidden');
    showLogin();
  });
  $('newBtn').addEventListener('click', async () => {
    const btn = $('newBtn');
    const ws = prompt('Carpeta de trabajo (vacío = sin acceso a archivos)', 'C:\\Dev');
    if (ws === null) return; // cancelado
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Creando…';
    try {
      const params = { commandId: await newCommandId() };
      if (ws.trim()) params.workspaceRoot = ws.trim();
      const session = await rpc('session/start', params);
      const id = (session && session.session && session.session.sessionId) || session.sessionId;
      await loadSessions();
      if (id) openSession(id);
    } catch (e) {
      toast('No se pudo crear la sesión: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
  $('sysBtn').addEventListener('click', () => {
    state.showSys = !state.showSys;
    try { localStorage.setItem('muse-remote-show-sys', state.showSys ? '1' : '0'); } catch {}
    for (const [id, it] of state.items) {
      const li = document.querySelector(`li[data-item="${CSS.escape(id)}"]`);
      if (li && it.kind === 'reminderChild') li.style.display = state.showSys ? '' : 'none';
    }
    updateSysBtn();
  });
  try { state.showSys = localStorage.getItem('muse-remote-show-sys') === '1'; } catch {}
  $('hiddenBtn').addEventListener('click', () => {
    state.showHidden = !state.showHidden;
    loadSessions();
  });
  const setTab = (tab) => { state.listTab = tab; loadSessions(); };
  $('tabChats').addEventListener('click', () => setTab('chats'));
  $('tabEmpty').addEventListener('click', () => setTab('empty'));
  $('backBtn').addEventListener('click', async () => {
    esGen++;
    exitPollMode();
    clearTimeout(state.esRetry);
    if (state.es) { try { state.es.close(); } catch {} state.es = null; }
    state.sessionId = null;
    show('sessionsView');
    await loadSessions();
  });
  $('composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('promptInput');
    const text = ta.value.trim();
    if (!text && !state.pendingImage) return;
    ta.value = '';
    try { await sendPrompt(text); }
    catch (err) { ta.value = text; toast('Error: ' + err.message); }
  });
  $('attachBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) attachImage(e.target.files[0]);
  });
  $('micBtn').addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Dictado no soportado en este navegador'); return; }
    try {
      const rec = new SR();
      rec.lang = 'es-ES';
      rec.onresult = (ev) => {
        const t = ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript;
        if (t) $('promptInput').value += ($('promptInput').value ? ' ' : '') + t;
      };
      rec.onerror = () => toast('Error de dictado');
      rec.start();
    } catch { toast('Dictado no disponible'); }
  });
  $('approvalSel').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try {
      await rpc('session/setApprovalMode', {
        commandId: await newCommandId(), sessionId: state.sessionId, mode: e.target.value,
      });
    } catch (err) { toast('Error: ' + err.message); }
  });
  $('steerBtn').addEventListener('click', async () => {
    if (!state.turnId) { toast('No hay turno en curso'); return; }
    const t = prompt('Dirigir turno en curso');
    if (!t) return;
    try {
      await rpc('turn/steer', {
        commandId: await newCommandId(), sessionId: state.sessionId,
        expectedTurnId: state.turnId, input: [{ type: 'text', text: t }],
      });
    } catch (e) { toast('Error: ' + e.message); }
  });
  $('unqueueBtn').addEventListener('click', async () => {
    if (!state.queuedTurnId) return;
    try {
      await rpc('turn/unqueue', {
        commandId: await newCommandId(), sessionId: state.sessionId, turnId: state.queuedTurnId,
      });
      state.queuedTurnId = null;
      $('unqueueBtn').classList.add('hidden');
    } catch (e) { toast('Error: ' + e.message); }
  });
  $('historyBtn').addEventListener('click', async () => {
    try {
      const r = await rpc('view/page', { sessionId: state.sessionId, limit: 200 });
      let n = 0;
      for (const ev of (r && r.events) || []) {
        if (ev && ev.method) { applyViewEvent(ev.method, ev.params || ev); n++; }
      }
      toast('Historial: ' + n + ' eventos');
    } catch (e) { toast('Error: ' + e.message); }
  });
  $('forkBtn').addEventListener('click', async () => {
    if (!confirm('¿Duplicar esta sesión (toda la historia)?')) return;
    try {
      const r = await rpc('session/fork', { commandId: await newCommandId(), sessionId: state.sessionId });
      const id = r && ((r.session && r.session.sessionId) || r.sessionId);
      toast('Sesión duplicada');
      await loadSessions();
      if (id) openSession(id);
    } catch (e) { toast('Error: ' + e.message); }
  });
  $('compactBtn').addEventListener('click', async () => {
    if (!confirm('¿Compactar el contexto de la sesión?')) return;
    try {
      const r = await rpc('session/compact', { commandId: await newCommandId(), sessionId: state.sessionId });
      toast('Compactación: ' + ((r && r.status) || 'aceptada'));
    } catch (e) { toast('Error: ' + e.message); }
  });
  const runShell = async () => {
    const cmd = $('shellInput').value.trim();
    if (!cmd) return;
    try {
      await rpc('session/userShell', { commandId: await newCommandId(), sessionId: state.sessionId, commandText: cmd });
      $('shellInput').value = '';
      toast('Comando aceptado — mira el transcript');
    } catch (e) { toast('Error: ' + e.message); }
  };
  $('shellBtn').addEventListener('click', runShell);
  $('shellInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runShell(); });
  $('modelSel').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try {
      await rpc('session/setModel', {
        commandId: await newCommandId(), sessionId: state.sessionId,
        model: { modelId: e.target.value },
      });
    } catch (err) { alert('Error: ' + err.message); }
  });
  $('effortSel').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try {
      await rpc('session/setReasoningEffort', {
        commandId: await newCommandId(), sessionId: state.sessionId,
        reasoningEffort: e.target.value,
      });
    } catch (err) { alert('Error: ' + err.message); }
  });
  $('cancelBtn').addEventListener('click', async () => {
    try {
      const p = { commandId: await newCommandId(), sessionId: state.sessionId };
      if (state.turnId) p.turnId = state.turnId;
      await rpc('turn/interrupt', p);
    } catch (e) { alert('Error: ' + e.message); }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});

function showLogin() { show('loginView'); setConn(false); }
async function boot() {
  // Badge honesto: solo "on" con backend y host MSP reales.
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    setConn(!!(j.ok && j.mspReady));
    if (!j.mspReady) toast('Backend sin host MSP — espera unos segundos y recarga');
  } catch {
    setConn(false);
    toast('Backend no disponible');
  }
  try {
    const u = await rpc('usage/read', {});
    const lines = [
      usageLine(u && u.usage && u.usage.window, 'Ventana'),
      usageLine(u && u.usage && u.usage.weekly, 'Semanal'),
    ].filter(Boolean);
    const el = $('usageLine');
    el.innerHTML = '';
    if (!lines.length) {
      el.textContent = 'sin datos';
    } else {
      for (const t of lines) {
        const d = document.createElement('div');
        d.textContent = t;
        el.append(d);
      }
      el.title = 'Datos del proveedor al momento de la lectura; pueden superar 100%';
    }
  } catch { $('usageLine').textContent = '—'; }
  const sessions = await loadSessions();
  // Retomar ultima sesion abierta (persistencia en este dispositivo).
  let last = null;
  try { last = localStorage.getItem('muse-remote-session'); } catch {}
  if (last && sessions.some((s) => s.sessionId === last)) openSession(last);
}

// Exportacion solo para tests node (en navegador `module` no existe).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseFrame, sessMeta, fmtDate, fmtRel, isEmptySession, sortSessions, sessTitle, turnos, usageLine, loadHidden, saveHidden, isHidden, CLIENT_MAX_IMAGE_DIM, CLIENT_MAX_IMAGE_BASE64_CHARS, CLIENT_MAX_RPC_BYTES, imageBase64TooLarge, streamEvents };
}
