'use strict';
// Cliente PWA: habla solo con este backend (mismo origen). Sin API keys.
const CLIENT_MAX_IMAGE_DIM = 1568; // lado mayor max del JPEG generado
const CLIENT_MAX_IMAGE_BASE64_CHARS = 4 * 1024 * 1024; // ~3 MiB binarios
const CLIENT_MAX_RPC_BYTES = 5 * 1024 * 1024; // espejo del limite del servidor
function imageBase64TooLarge(b64) {
  return typeof b64 === 'string' && b64.length > CLIENT_MAX_IMAGE_BASE64_CHARS;
}
const $ = (id) => document.getElementById(id);
const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
const state = {
  token: localStorage.getItem('muse-remote-token') || '',
  sessionId: null,
  viewCursor: null,
  es: null,
  running: false,
  items: new Map(), // itemId -> {kind, text, ...}
  fullOutputs: new Map(), // itemId -> salida completa leida con "Ver completo"
  turnId: null,
  queuedTurnId: null,
  pendingImage: null, // {base64Data, mediaType, width, height}
  showSys: false,
  showHidden: false,
  listTab: 'chats', // chats | empty
  query: '',
  sessions: null, // cache del ultimo session/list (re-render local sin red)
  pollMode: false,
  sending: false,
  openSeq: 0,
  unread: 0,
  rec: null,
  turnStartedAt: 0,
  activity: '',
  expanded: new Set(), // mensajes largos desplegados
  notify: false,
  pushOn: false,
  thumbs: null, // itemId -> [dataUrl] (miniaturas de imagenes enviadas)
  pendingThumb: null,
  flushing: false,
};
function loadHidden() {
  try { return JSON.parse(localStorage.getItem('muse-remote-hidden') || '[]'); }
  catch { return []; }
}
function saveHidden(ids) {
  try { localStorage.setItem('muse-remote-hidden', JSON.stringify(ids)); } catch {}
}
function isHidden(id) { return loadHidden().includes(id); }
function store(k, v) { try { if (v === null || v === undefined || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} }
function recall(k) { try { return localStorage.getItem(k); } catch { return null; } }

// ---- red ----
// Traduce errores tecnicos del puente a mensajes comprensibles.
function friendlyError(msg) {
  const m = String(msg || '');
  if (/msp host not ready/i.test(m)) return 'Muse aún está arrancando; reintenta en unos segundos';
  if (/msp timeout/i.test(m)) return 'Muse tardó demasiado en responder';
  if (/msp host (exited|not running)/i.test(m)) return 'El proceso de Muse se reinició; reintenta';
  if (/body too large|image too large/i.test(m)) return 'El contenido es demasiado grande';
  return m;
}
async function api(path, opts) {
  let r;
  try { r = await fetch(path, opts); }
  catch { throw Object.assign(new Error('sin conexión con el backend'), { network: true }); }
  if (r.status === 401) {
    onUnauthorized();
    throw new Error('token incorrecto o caducado');
  }
  let j = null;
  try { j = await r.json(); } catch { /* cuerpo no JSON */ }
  if (!j) throw new Error('respuesta inválida del backend (HTTP ' + r.status + ')');
  return { r, j };
}
async function rpc(method, params) {
  const { r, j } = await api('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.token },
    body: JSON.stringify({ method, params }),
  });
  // 503 = Muse aun arrancando: reintentable igual que un corte de red.
  if (!j.ok) throw Object.assign(new Error(friendlyError(j.error || ('rpc ' + r.status))), { network: r.status === 503 });
  return j.result;
}
async function newCommandId() {
  const { j } = await api('/api/command-id', { headers: { authorization: 'Bearer ' + state.token } });
  if (!j.ok || !j.commandId) throw new Error(j.error || 'no se pudo generar commandId');
  return j.commandId;
}
function onUnauthorized() {
  if (!state.token) return;
  logout();
  $('loginErr').textContent = 'El token ya no es válido. Introdúcelo de nuevo.';
}

// ---- vistas ----
const VIEWS = ['loginView', 'sessionsView', 'chatView'];
function show(name, opts) {
  const focus = !opts || opts.focus !== false;
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== name);
  const el = $(name);
  el.classList.remove('view-enter');
  void el.offsetWidth; // reinicia la animacion de entrada
  el.classList.add('view-enter');
  document.body.dataset.view = name;
  const inChat = name === 'chatView';
  $('backBtn').classList.toggle('hidden', !inChat);
  $('menuBtn').classList.toggle('hidden', !inChat);
  $('statusBadge').classList.toggle('hidden', !inChat);
  $('logoutBtn').classList.toggle('hidden', name !== 'sessionsView');
  if (!inChat) { setTopTitle('Muse Remote', ''); updateJump(false); document.title = 'Muse Remote'; }
  if (focus) {
    const h = el.querySelector('[data-view-focus]');
    if (h) { try { h.focus({ preventScroll: true }); } catch { h.focus(); } }
  }
}
// Altura real del composer -> padding inferior del chat / posicion de toasts.
function setComposerH() {
  const c = $('composer');
  if (c && c.offsetHeight) document.documentElement.style.setProperty('--composer-h', c.offsetHeight + 'px');
}
function setTopTitle(title, sub) {
  $('topTitle').textContent = title;
  const s = $('topSub');
  s.textContent = sub || '';
  s.classList.toggle('hidden', !sub);
}
const CONN_LABEL = { on: ['en vivo', 'conectado en vivo'], off: ['offline', 'sin conexión'], waiting: ['poll', 'actualizando cada 10 s (sin directo)'] };
function setConnState(st) {
  const c = $('conn');
  c.dataset.state = st;
  c.textContent = CONN_LABEL[st][0];
  c.setAttribute('aria-label', 'Conexión: ' + CONN_LABEL[st][1]);
}
function setConn(on) { setConnState(on ? 'on' : 'off'); }
const STATUS_LABEL = { idle: 'listo', running: 'trabajando', waiting: 'esperando' };
function setStatus(s) {
  const b = $('statusBadge');
  if (b.dataset.state === 'waiting' && s === 'waiting') return;
  b.dataset.state = s;
  b.textContent = STATUS_LABEL[s] || s;
  b.setAttribute('aria-label', 'Estado de la sesión: ' + (STATUS_LABEL[s] || s));
  $('cancelBtn').classList.toggle('hidden', !(s === 'running' || state.running));
  updateWorking();
  updateBadge();
  if (document.body.dataset.view === 'chatView') {
    document.title = (s === 'waiting' ? '● ' : s === 'running' ? '… ' : '') + 'Muse Remote';
  }
}
function settleStatus() { setStatus(pendingCount() ? 'waiting' : (state.running ? 'running' : 'idle')); }
function announce(text) {
  const a = $('announcer');
  if (!a) return;
  a.textContent = '';
  setTimeout(() => { a.textContent = text; }, 60);
}
function icon(name, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.classList.toggle('is-loading', !!busy);
  if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch {} }

// ---- dialogos accesibles (sustituyen prompt/confirm/alert nativos) ----
function openDialog(d) {
  if (d.open) return;
  d.classList.remove('closing');
  d.showModal();
  document.body.classList.add('modal-open');
}
function closeDialog(d, value) {
  if (!d.open || d.classList.contains('closing')) return;
  const finish = () => {
    d.classList.remove('closing');
    if (d.open) d.close(value);
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
  };
  if (prefersReducedMotion()) { finish(); return; }
  d.classList.add('closing');
  setTimeout(finish, 200);
}
// ask({title, message, input: 'text'|'textarea', value, placeholder, okLabel, danger})
// -> texto (con input), true (confirmacion) o null (cancelado).
function ask(opts) {
  return new Promise((resolve) => {
    const d = $('dlg');
    $('dlgTitle').textContent = opts.title || '';
    $('dlgMsg').textContent = opts.message || '';
    const inp = $('dlgInput');
    const area = $('dlgArea');
    const field = opts.input === 'textarea' ? area : (opts.input ? inp : null);
    inp.classList.toggle('hidden', field !== inp);
    area.classList.toggle('hidden', field !== area);
    if (field) {
      field.value = opts.value || '';
      field.placeholder = opts.placeholder || '';
      $('dlgFieldLabel').textContent = opts.title || 'Valor';
    }
    const ok = $('dlgOk');
    ok.textContent = opts.okLabel || 'Aceptar';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    d.returnValue = '';
    const onClose = () => {
      d.removeEventListener('close', onClose);
      if (d.returnValue !== 'ok') return resolve(null);
      resolve(field ? field.value : true);
    };
    d.addEventListener('close', onClose);
    openDialog(d);
    if (field) {
      field.focus();
      try { field.setSelectionRange(field.value.length, field.value.length); } catch {}
    } else ok.focus();
  });
}

// ---- login ----
async function tryLogin(token) {
  let r;
  try { r = await fetch('/api/health'); } catch { throw new Error('backend no disponible'); }
  if (!r.ok) throw new Error('backend no disponible');
  // health es publica; validar token con una llamada barata
  let t;
  try {
    t = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ method: 'model/list', params: {} }),
    });
  } catch { throw new Error('backend no disponible'); }
  if (t.status === 401) throw new Error('Token incorrecto');
  let j = null;
  try { j = await t.json(); } catch {}
  if (!j) throw new Error('respuesta inválida del backend');
  if (!j.ok) throw new Error(friendlyError(j.error || 'error MSP'));
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
function wsName(root) {
  if (!root) return '';
  return String(root).split(/[/\\]/).filter(Boolean).pop() || String(root);
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
    const w = wsName(s.workspaceRoot);
    if (w) parts.push(w);
  }
  return parts.join(' · ');
}
// Filtro puro (testeable): ocultas, pestaña y búsqueda sobre la cache.
function filterSessions(list, opts) {
  const o = opts || {};
  const hidden = o.hidden || [];
  const q = String(o.query || '').trim().toLowerCase();
  let nHidden = 0;
  const visible = sortSessions(list).filter((s) => {
    if (hidden.includes(s.sessionId) && !o.showHidden) { nHidden++; return false; }
    return true;
  });
  const nEmpty = visible.filter(isEmptySession).length;
  const nChats = visible.length - nEmpty;
  const rows = visible.filter((s) => {
    const empty = isEmptySession(s);
    if (o.tab === 'empty' ? !empty : empty) return false;
    if (!q) return true;
    const hay = [sessTitle(s), s.workspaceRoot || '', s.modelId || '', s.sessionId || ''].join(' ').toLowerCase();
    return hay.includes(q);
  });
  return { rows, nChats, nEmpty, nHidden };
}
// Sin session/list paralelas: si hay un listado en vuelo (puede tardar
// ~100 s la primera vez), las llamadas automaticas reutilizan esa promesa
// en vez de lanzar otra. Pestañas, busqueda y ocultar re-renderizan desde
// la cache local sin volver a la red.
let sessionsLoading = null;
async function loadSessions(silent) {
  if (sessionsLoading) return sessionsLoading;
  sessionsLoading = loadSessionsInner(silent === true).finally(() => { sessionsLoading = null; });
  return sessionsLoading;
}
function renderSkeleton() {
  const ul = $('sessionList');
  ul.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const li = document.createElement('li');
    li.className = 'skel';
    li.setAttribute('aria-hidden', 'true');
    li.append(document.createElement('span'), document.createElement('span'));
    ul.append(li);
  }
  const note = document.createElement('li');
  note.className = 'loading-note';
  note.textContent = 'Cargando sesiones… la primera vez puede tardar hasta 2 minutos.';
  ul.append(note);
}
async function loadSessionsInner(silent) {
  const t0 = Date.now();
  const ul = $('sessionList');
  const rb = $('refreshBtn');
  ul.setAttribute('aria-busy', 'true');
  if (rb) { rb.classList.add('spin'); rb.disabled = true; }
  if (!state.sessions) renderSkeleton();
  let res;
  try {
    res = await rpc('session/list', { limit: 50 });
  } catch (e) {
    if (!state.sessions) {
      ul.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'empty-state';
      const st = document.createElement('strong');
      st.textContent = 'No se pudieron cargar las sesiones';
      const p = document.createElement('div');
      p.textContent = e.message;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary';
      b.textContent = 'Reintentar';
      b.addEventListener('click', () => loadSessions());
      li.append(st, p, b);
      ul.append(li);
    } else if (!silent) {
      toast('No se pudo actualizar la lista: ' + e.message);
    }
    return [];
  } finally {
    ul.setAttribute('aria-busy', 'false');
    if (rb) { rb.classList.remove('spin'); rb.disabled = false; }
  }
  state.lastListMs = Date.now() - t0;
  state.sessions = res.sessions || [];
  renderSessions();
  return state.sessions;
}
function renderSessions() {
  const ul = $('sessionList');
  if (!state.sessions) return;
  const hidden = loadHidden();
  const { rows, nChats, nEmpty, nHidden } = filterSessions(state.sessions, {
    hidden, showHidden: state.showHidden, tab: state.listTab, query: state.query,
  });
  const tc = $('tabChats');
  const te = $('tabEmpty');
  tc.textContent = `Chats (${nChats})`;
  te.textContent = `Vacías (${nEmpty})`;
  for (const [b, on] of [[tc, state.listTab === 'chats'], [te, state.listTab === 'empty']]) {
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
  $('sessionPanel').setAttribute('aria-labelledby', state.listTab === 'chats' ? 'tabChats' : 'tabEmpty');
  const hb = $('hiddenBtn');
  hb.setAttribute('aria-pressed', state.showHidden ? 'true' : 'false');
  hb.textContent = 'Ocultas' + (!state.showHidden && nHidden ? ` (${nHidden})` : '');
  ul.innerHTML = '';
  rows.forEach((s, i) => {
    const hid = hidden.includes(s.sessionId);
    const title = sessTitle(s);
    const li = document.createElement('li');
    li.className = 'sess-card';
    li.style.setProperty('--i', String(Math.min(i, 12)));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sess-open';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.status = s.status || '';
    dot.setAttribute('aria-hidden', 'true');
    const tt = document.createElement('span');
    tt.className = 'sess-title';
    if (hid) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'oculta';
      tt.append(tag);
    }
    const nOut = outboxFor(s.sessionId).length;
    if (nOut) {
      const tag = document.createElement('span');
      tag.className = 'tag tag-warn';
      tag.textContent = nOut === 1 ? '1 pendiente' : nOut + ' pendientes';
      tt.append(tag);
    }
    tt.append(document.createTextNode(title));
    const m = document.createElement('span');
    m.className = 'sid';
    m.textContent = [STATUS_LABEL[s.status] || s.status || '', s.modelId || 'modelo?', turnos(s.turnCount), fmtRel(s.updatedAt || s.createdAt)].filter(Boolean).join(' · ');
    const txt = document.createElement('span');
    txt.className = 'sess-txt';
    txt.append(tt, m);
    if (s.workspaceRoot) {
      const w = document.createElement('span');
      w.className = 'ws-chip';
      w.title = s.workspaceRoot;
      w.append(icon('folder'), document.createTextNode(wsName(s.workspaceRoot)));
      txt.append(w);
    }
    b.append(dot, txt);
    b.addEventListener('click', () => openSession(s.sessionId, b, s));
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'icon-btn sess-hide';
    h.setAttribute('aria-label', (hid ? 'Mostrar' : 'Ocultar') + ' sesión: ' + title);
    h.title = hid ? 'Mostrar' : 'Ocultar';
    h.append(icon(hid ? 'eye' : 'eye-off'));
    h.addEventListener('click', () => {
      const ids = loadHidden();
      if (hid) saveHidden(ids.filter((x) => x !== s.sessionId));
      else { ids.push(s.sessionId); saveHidden(ids); }
      renderSessions();
      toast(hid ? 'Sesión visible de nuevo' : 'Sesión ocultada', 'info');
    });
    li.append(b, h);
    ul.append(li);
  });
  if (!ul.children.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    const st = document.createElement('strong');
    const p = document.createElement('div');
    if (state.query) {
      st.textContent = 'Sin resultados';
      p.textContent = `Ninguna sesión coincide con “${state.query}”.`;
    } else if (state.listTab === 'empty') {
      st.textContent = 'Sin sesiones vacías';
      p.textContent = 'Todo limpio.';
    } else {
      st.textContent = 'Aún no hay conversaciones';
      p.textContent = 'Crea una sesión nueva para empezar.';
    }
    li.append(st, p);
    if (!state.query && state.listTab === 'chats') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary';
      b.textContent = 'Nueva sesión';
      b.addEventListener('click', () => $('newBtn').click());
      li.append(b);
    }
    ul.append(li);
  }
}

function stopEvents() {
  esGen++;
  setBanner(null);
  exitPollMode();
  clearTimeout(state.esRetry);
  state.esRetry = null;
  if (state.es) { try { state.es.close(); } catch {} state.es = null; }
  state.lastEventAt = 0;
}
function resetChatState() {
  state.items.clear();
  state.fullOutputs.clear();
  renderQueue.clear();
  state.running = false;
  state.turnId = null;
  state.queuedTurnId = null;
  state.turnStartedAt = 0;
  state.activity = '';
  state.expanded.clear();
  state.unread = 0;
  state.esFails = 0;
  $('unqueueBtn').classList.add('hidden');
  $('transcript').innerHTML = '';
  $('approvals').innerHTML = '';
  $('netinfo').textContent = '';
  // El esfuerzo y la skill son por sesion: no arrastrarlos a otra.
  $('effortSel').value = '';
  commitSelect($('effortSel'));
  $('skillSel').value = '';
  clearImage();
  updateChips();
}
async function openSession(sessionId, btn, known, opts) {
  const seq = ++state.openSeq;
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    const res = await rpc('session/resume', { commandId: await newCommandId(), sessionId });
    if (seq !== state.openSeq) return; // el usuario abrio otra mientras tanto
    stopEvents();
    resetChatState();
    store('muse-remote-session', sessionId);
    state.sessionId = sessionId;
    const sess = Object.assign({ sessionId }, known || {}, res.session || {});
    show('chatView');
    if (!(opts && opts.noHistory)) {
      // Ya en una entrada de chat (recarga o cambio de sesion): reemplazar,
      // para no apilar entradas que el boton atras tendria que deshacer.
      try {
        if (history.state && history.state.view === 'chat') history.replaceState({ view: 'chat', sessionId }, '');
        else history.pushState({ view: 'chat', sessionId }, '');
      } catch {}
    }
    const title = sessTitle(sess);
    setTopTitle(title, sess.workspaceRoot ? wsName(sess.workspaceRoot) : 'sin carpeta');
    $('chatTitle').textContent = 'Chat: ' + title;
    state.viewCursor = res.viewCursor || null;
    const ws = $('wsLine');
    ws.innerHTML = '';
    ws.append(icon('folder'), document.createTextNode(sess.workspaceRoot
      ? sess.workspaceRoot
      : 'Sin carpeta de trabajo (sin acceso a archivos)'));
    renderHistory(res.history);
    state.running = !!(res.session && res.session.status === 'running');
    if (state.running) { state.turnStartedAt = Date.now(); state.activity = 'Trabajando'; }
    setStatus(state.running ? 'running' : 'idle');
    updateEmpty();
    restoreDraft();
    setComposerH();
    scrollToBottom(false);
    raf(() => scrollToBottom(false)); // tras el layout de fuentes/imagenes
    // El stream arranca ya (gapless con viewCursor); el resto en paralelo.
    connectEvents();
    renderOutbox();
    await Promise.allSettled([refreshModels(res.session), refreshApproval(res.session), refreshSkills(), refreshPending()]);
    if (seq === state.openSeq && outboxFor(sessionId).length && navigator.onLine !== false) flushOutbox(false);
  } catch (e) {
    if (seq === state.openSeq) toast('No se pudo abrir la sesión: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}
function leaveChat() {
  stopEvents();
  state.openSeq++;
  saveDraft();
  state.sessionId = null;
  store('muse-remote-session', null);
  if (state.rec) { try { state.rec.stop(); } catch {} }
  if ($('sheet').open) closeDialog($('sheet'));
  show('sessionsView');
  renderSessions();
  loadSessions();
}

function renderHistory(history) {
  if (!history) return;
  let added = 0;
  // session/resume devuelve Items directos (history.items), no eventos view.
  for (const item of history.items || []) {
    if (item && item.itemId) {
      state.items.set(item.itemId, item);
      if (renderItem(item)) added++;
      if (item.viewCursor) state.viewCursor = item.viewCursor;
    }
  }
  // view/page sí devuelve notificaciones {method, params}.
  for (const ev of history.events || []) {
    if (ev && ev.method) applyViewEvent(ev.method, ev.params || ev);
  }
  return added;
}

function textOf(item) {
  if (!item) return '';
  if (typeof item.text === 'string') return item.text;
  if (Array.isArray(item.summary)) return item.summary.join('\n');
  if (typeof item.output === 'string') return item.output;
  if (typeof item.displayText === 'string') return item.displayText;
  return '';
}

// ---- vista legible de herramientas: args JSON -> resumen + diff ----
function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  if (typeof a !== 'string') return null;
  try { const v = JSON.parse(a); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
function looksLikeDiff(t) {
  return typeof t === 'string' && /^(diff --git |--- |\+\+\+ |@@ )/m.test(t) && /^[+-]/m.test(t);
}
function lineDiff(oldS, newS) {
  const out = [];
  if (oldS) for (const l of String(oldS).split('\n')) out.push('-' + l);
  if (newS) for (const l of String(newS).split('\n')) out.push('+' + l);
  return out.join('\n');
}
function diffStats(diff) {
  let add = 0;
  let del = 0;
  for (const l of String(diff || '').split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) add++;
    else if (l.startsWith('-')) del++;
  }
  return { add, del };
}
function toolView(item) {
  const parsed = parseArgs(item.args);
  const a = parsed || {};
  let cmd = item.commandText || a.command || a.cmd || a.commandText || a.argv || '';
  if (Array.isArray(cmd)) cmd = cmd.join(' ');
  const path = a.path || a.file_path || a.filePath || a.file || a.target_file || '';
  const pattern = a.pattern || a.query || a.regex || '';
  let summary = '';
  if (cmd) summary = '$ ' + String(cmd);
  else if (path) summary = String(path);
  else if (pattern) summary = String(pattern);
  else if (a.url) summary = String(a.url);
  let diff = null;
  if (typeof a.diff === 'string') diff = a.diff;
  else if (typeof a.patch === 'string') diff = a.patch;
  else if (typeof a.old_string === 'string' || typeof a.new_string === 'string') diff = lineDiff(a.old_string || '', a.new_string || '');
  else if (typeof a.oldText === 'string' || typeof a.newText === 'string') diff = lineDiff(a.oldText || '', a.newText || '');
  else if (typeof a.content === 'string' && path) diff = lineDiff('', a.content);
  const st = diff ? diffStats(diff) : { add: 0, del: 0 };
  return { summary: summary.replace(/\s+/g, ' ').slice(0, 300), diff, add: st.add, del: st.del, parsed: !!parsed, args: parsed };
}
function renderDiff(diff) {
  const pre = document.createElement('pre');
  pre.className = 'diff';
  const lines = String(diff).split('\n');
  const MAX = 500;
  lines.slice(0, MAX).forEach((l) => {
    const span = document.createElement('span');
    if (l.startsWith('+') && !l.startsWith('+++')) span.className = 'd-add';
    else if (l.startsWith('-') && !l.startsWith('---')) span.className = 'd-del';
    else if (l.startsWith('@@') || l.startsWith('diff ') || l.startsWith('+++') || l.startsWith('---')) span.className = 'd-hunk';
    span.textContent = l + '\n';
    pre.append(span);
  });
  if (lines.length > MAX) {
    const more = document.createElement('span');
    more.className = 'd-hunk';
    more.textContent = `… ${lines.length - MAX} líneas más`;
    pre.append(more);
  }
  return pre;
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// ---- resaltado de sintaxis ligero (tokens -> spans, nunca innerHTML) ----
const KW_C = 'if else for while do switch case default break continue return goto sizeof struct union enum typedef static const void char short int long float double unsigned signed extern volatile class public private protected new delete this try catch throw finally namespace using virtual override template typename import package interface extends implements final abstract var val fun func when object companion is in as let mut fn impl trait match loop pub use mod crate self super where async await yield lambda def elif except raise pass with from global nonlocal del assert not and or print';
const HL_KW = {
  js: 'break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rs: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  sh: 'if then else elif fi for while until do done case esac in function return local export readonly echo exit set unset cd source alias sudo',
  sql: 'select from where insert into values update set delete create table drop alter join left right inner outer full on group by order having limit offset as and or not null is primary key foreign references index distinct union all case when then else end',
  c: KW_C,
};
HL_KW.ts = HL_KW.js + ' interface type enum implements declare namespace abstract private protected public readonly keyof as satisfies';
const HL_LANG = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', js: 'js', node: 'js', json: 'json', jsonc: 'js',
  typescript: 'ts', ts: 'ts', tsx: 'ts', python: 'py', py: 'py', py3: 'py', go: 'go', golang: 'go',
  rust: 'rs', rs: 'rs', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh', pwsh: 'sh',
  sql: 'sql', c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cc: 'c', cs: 'c', csharp: 'c', java: 'c', kotlin: 'c', kt: 'c', swift: 'c', php: 'c', dart: 'c', scala: 'c',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', dockerfile: 'sh', makefile: 'sh', ruby: 'py', rb: 'py', r: 'py',
};
const HL_LIT = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'NaN', 'Infinity']);
const HL_RE = {};
function hlRegex(fam) {
  if (HL_RE[fam]) return HL_RE[fam];
  const hash = ['py', 'sh', 'yaml'].includes(fam);
  const com = fam === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : hash ? '#[^\\n]*' : (fam === 'json' || fam === 'plain') ? '(?!)' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const str = (fam === 'py' ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|' : '')
    + '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\''
    + (['js', 'ts', 'go', 'sh'].includes(fam) ? '|`(?:\\\\.|[^`\\\\])*`' : '');
  const num = '\\b(?:0[xX][\\da-fA-F]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b';
  HL_RE[fam] = new RegExp(`(${com})|(${str})|(${num})|([A-Za-z_$][\\w$]*)`, 'g');
  return HL_RE[fam];
}
function highlight(code, lang) {
  const src = String(code || '');
  const fam = HL_LANG[String(lang || '').toLowerCase()] || 'plain';
  if (src.length > 20000) return [{ t: 'txt', v: src }];
  const kw = new Set((HL_KW[fam] || '').split(' ').filter(Boolean));
  const re = hlRegex(fam);
  re.lastIndex = 0;
  const out = [];
  const push = (t, v) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === t && t === 'txt') last.v += v; else out.push({ t, v });
  };
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    push('txt', src.slice(last, m.index));
    if (m[1]) push('com', m[1]);
    else if (m[2]) push('str', m[2]);
    else if (m[3]) push('num', m[3]);
    else {
      const w = m[4];
      const lw = fam === 'sql' ? w.toLowerCase() : w;
      if (HL_LIT.has(w)) push('lit', w);
      else if (kw.has(lw)) push('kw', w);
      else if (src[re.lastIndex] === '(') push('fn', w);
      else push('txt', w);
    }
    last = re.lastIndex;
  }
  push('txt', src.slice(last));
  return out;
}
function renderCode(codeEl, text, lang) {
  for (const tok of highlight(text, lang)) {
    if (tok.t === 'txt') { codeEl.append(document.createTextNode(tok.v)); continue; }
    const sp = document.createElement('span');
    sp.className = 'tok-' + tok.t;
    sp.textContent = tok.v;
    codeEl.append(sp);
  }
}

// ---- imagenes en el historial ----
// Busca partes de imagen en las formas habituales de un item (defensivo:
// el esquema exacto puede variar). Solo data: de tipos image/*.
function extractImages(item) {
  const out = [];
  if (!item || typeof item !== 'object') return out;
  for (const arr of [item.images, item.attachments, item.content, item.input, item.parts]) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== 'object') continue;
      const src = p.source && typeof p.source === 'object' ? p.source : {};
      const mt = String(p.mediaType || p.mimeType || p.media_type || src.media_type || '');
      if (p.type !== 'image' && !/^image\//.test(mt)) continue;
      const data = p.base64Data || p.data || src.data;
      const type = /^image\/[\w.+-]+$/.test(mt) ? mt : 'image/jpeg';
      if (typeof data === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 256))) out.push('data:' + type + ';base64,' + data.replace(/\s+/g, ''));
      else if (typeof p.url === 'string' && /^data:image\/[\w.+-]+;base64,/.test(p.url)) out.push(p.url);
    }
  }
  return out.slice(0, 8);
}
const THUMBS_KEY = 'muse-remote-thumbs';
function thumbsMap() {
  if (!state.thumbs) {
    state.thumbs = new Map();
    try {
      const o = JSON.parse(localStorage.getItem(THUMBS_KEY) || '[]');
      if (Array.isArray(o)) for (const [k, v] of o) if (typeof k === 'string' && Array.isArray(v)) state.thumbs.set(k, v);
    } catch {}
  }
  return state.thumbs;
}
function rememberThumb(itemId, url) {
  const m = thumbsMap();
  m.delete(itemId);
  m.set(itemId, [url]);
  while (m.size > 40) m.delete(m.keys().next().value); // LRU: ~40 miniaturas
  try { localStorage.setItem(THUMBS_KEY, JSON.stringify([...m])); } catch { /* cuota llena: solo memoria */ }
}
function makeThumb(img, max) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * scale));
  cv.height = Math.max(1, Math.round(img.height * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.7);
}
function renderImages(urls) {
  const grid = document.createElement('div');
  grid.className = 'att-grid';
  urls.forEach((u, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'att-btn';
    b.setAttribute('aria-label', `Ver imagen adjunta ${i + 1} a pantalla completa`);
    const im = document.createElement('img');
    im.src = u;
    im.alt = '';
    im.loading = 'lazy';
    im.decoding = 'async';
    b.append(im);
    b.addEventListener('click', () => openViewer(u));
    grid.append(b);
  });
  return grid;
}
function openViewer(url) {
  const d = $('viewer');
  $('viewerImg').src = url;
  openDialog(d);
  $('viewerClose').focus();
}

// ---- cola de envio sin conexion (outbox) ----
// Los mensajes que no se pudieron enviar por red se guardan en este
// dispositivo y se reenvian al reconectar. El commandId se fija en el primer
// intento: si la respuesta se perdio, MSP deduplica el reintento.
const OUTBOX_KEY = 'muse-remote-outbox';
function outboxLoad() {
  try { const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function outboxSave(list) {
  try { if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-50))); else localStorage.removeItem(OUTBOX_KEY); } catch {}
}
function outboxAdd(entry) {
  const e = Object.assign({ id: 'ob-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: Date.now() }, entry);
  delete e.image; // las imagenes no se guardan (tamaño)
  const l = outboxLoad();
  l.push(e);
  outboxSave(l);
  return e;
}
function outboxUpdate(entry) { outboxSave(outboxLoad().map((e) => (e.id === entry.id ? entry : e))); }
function outboxRemove(id) { outboxSave(outboxLoad().filter((e) => e.id !== id)); }
function outboxFor(sid) { return outboxLoad().filter((e) => e.sessionId === sid); }
function isRetryable(err) { return !!(err && err.network); }

// ---- Web Push ----
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window;
}
async function pushSubscribe(test) {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const { j } = await api('/api/push/key', { headers: { authorization: 'Bearer ' + state.token } });
  if (!j.ok || !j.publicKey) return false;
  const key = urlB64ToUint8(j.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Clave VAPID rotada en el backend: la suscripcion antigua ya no sirve.
  if (sub && sub.options && sub.options.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    if (cur.length !== key.length || cur.some((b, i) => b !== key[i])) { try { await sub.unsubscribe(); } catch {} sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { j: r } = await api('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.token },
    body: JSON.stringify({ subscription: sub.toJSON(), test: !!test }),
  });
  return !!r.ok;
}
async function pushUnsubscribe() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await api('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ subscription: { endpoint: sub.endpoint } }),
    }).catch(() => {});
    await sub.unsubscribe();
  } catch {}
}

// ---- markdown ligero y seguro (solo nodos de texto, nunca innerHTML) ----
// Divide en bloques de texto y de codigo cercados (```). Un cercado sin
// cerrar (streaming) se trata como codigo hasta el final.
function splitFences(text) {
  const out = [];
  const src = String(text || '');
  const re = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
    out.push({ type: 'code', lang: m[1].trim(), text: m[2].replace(/\n$/, '') });
    last = re.lastIndex;
    if (last >= src.length) break;
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
  return out;
}
// Tokens en linea: `codigo`, **negrita** y enlaces http(s).
function parseInline(text) {
  const out = [];
  const src = String(text || '');
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"`])/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1]) out.push({ t: 'code', v: m[1].slice(1, -1) });
    else if (m[2]) out.push({ t: 'bold', v: m[2].slice(2, -2) });
    else out.push({ t: 'link', v: m[3] });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}
function appendInline(parent, line) {
  for (const tok of parseInline(line)) {
    if (tok.t === 'text') parent.append(document.createTextNode(tok.v));
    else if (tok.t === 'code') { const c = document.createElement('code'); c.textContent = tok.v; parent.append(c); }
    else if (tok.t === 'bold') { const b = document.createElement('strong'); b.textContent = tok.v; parent.append(b); }
    else {
      const a = document.createElement('a');
      a.href = tok.v; a.textContent = tok.v; a.target = '_blank'; a.rel = 'noopener noreferrer';
      parent.append(a);
    }
  }
}
function renderRich(text, plain) {
  const root = document.createElement('div');
  root.className = 'md';
  if (plain) { root.textContent = text; return root; }
  const segs = splitFences(text);
  segs.forEach((seg, si) => {
    if (seg.type !== 'text') return;
    // Sin saltos sobrantes pegados a un bloque de codigo (white-space: pre-wrap).
    if (si > 0 && segs[si - 1].type === 'code') seg.text = seg.text.replace(/^\n/, '');
    if (si < segs.length - 1 && segs[si + 1].type === 'code') seg.text = seg.text.replace(/\n+$/, '');
  });
  for (const seg of segs) {
    if (seg.type === 'code') {
      const box = document.createElement('div');
      box.className = 'code-block';
      const head = document.createElement('div');
      head.className = 'code-head';
      const lang = document.createElement('span');
      lang.textContent = seg.lang || 'código';
      const cp = document.createElement('button');
      cp.type = 'button';
      cp.className = 'icon-btn';
      cp.setAttribute('aria-label', 'Copiar código');
      cp.append(icon('copy'));
      cp.addEventListener('click', () => copyText(seg.text));
      head.append(lang, cp);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      renderCode(code, seg.text, seg.lang);
      pre.append(code);
      box.append(head, pre);
      root.append(box);
      continue;
    }
    const lines = seg.text.split('\n');
    lines.forEach((line, i) => {
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) {
        const s = document.createElement('strong');
        s.className = 'md-h';
        appendInline(s, h[1]);
        root.append(s);
        return; // .md-h es bloque: sin salto extra
      }
      const li = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      if (li) {
        root.append(document.createTextNode(li[1] + '• '));
        appendInline(root, li[2]);
      } else {
        appendInline(root, line);
      }
      if (i < lines.length - 1) root.append(document.createTextNode('\n'));
    });
  }
  return root;
}
async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  toast('Copiado al portapapeles', 'info');
  vibrate(8);
}

const ITEM_STATUS = {
  completed: 'hecho', succeeded: 'hecho', done: 'hecho', running: 'en curso', inProgress: 'en curso',
  started: 'en curso', pending: 'pendiente', failed: 'error', error: 'error', denied: 'denegado',
  cancelled: 'cancelado', canceled: 'cancelado', interrupted: 'detenido', backgrounded: 'en segundo plano',
};
function statusText(s) { return ITEM_STATUS[s] || s; }
function isFinished(s) { return /complet|succe|done|fail|error|cancel|denied|interrupt/i.test(String(s || '')); }
const KIND_LABEL = {
  userMessage: 'Tú', agentMessage: 'Muse', reasoning: 'Razonamiento', toolCall: 'Herramienta',
  userShell: 'Shell', subagent: 'Subagente', workflow: 'Workflow', reminderChild: 'Sistema', message: 'Mensaje',
};
const COLLAPSIBLE = new Set(['toolCall', 'userShell', 'reasoning', 'reminderChild', 'subagent', 'workflow']);
function labelFor(item) {
  const base = KIND_LABEL[item.kind] || item.kind || 'Mensaje';
  if (item.kind === 'toolCall') return item.toolName || item.callId || base;
  return base;
}
function msgButton(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-ghost btn-sm';
  b.textContent = label;
  b.addEventListener('click', async () => {
    setBusy(b, true);
    try { await fn(); } catch (e) { toast('Error: ' + e.message); } finally { setBusy(b, false); }
  });
  return b;
}
// Devuelve true si creo un elemento nuevo visible.
function renderItem(item) {
  const id = item.itemId || '';
  const li = id ? document.querySelector(`li[data-item="${CSS.escape(id)}"]`) : null;
  const kind = item.kind || 'message';
  const host = li || document.createElement('li');
  // Conservar <details> abiertos entre re-renders (deltas en streaming).
  const prevOpen = li ? Array.from(li.querySelectorAll('details')).map((d) => d.open) : [];
  host.className = 'msg' + (li ? '' : ' msg-enter');
  host.dataset.kind = kind;
  if (id) host.dataset.item = id;
  host.innerHTML = '';
  const k = document.createElement('span');
  k.className = 'kind';
  const t = textOf(item);
  const body = document.createElement('div');
  const acts = document.createElement('div');
  acts.className = 'btns';

  const isTool = kind === 'toolCall' || kind === 'userShell';
  const tv = isTool ? toolView(item) : null;
  if (tv && tv.diff) body.append(renderDiff(tv.diff));
  else if (item.toolName || item.args) {
    const pre = document.createElement('pre');
    pre.textContent = tv && tv.parsed
      ? JSON.stringify(tv.args, null, 2).slice(0, 3000)
      : (item.toolName || '') + (item.args ? ' ' + String(item.args).slice(0, 2000) : '');
    body.append(pre);
  }
  // Imagenes del mensaje (del item o miniatura recordada de un envio propio).
  let imgs = kind === 'userMessage' ? extractImages(item) : [];
  if (kind === 'userMessage' && !imgs.length && id) {
    const pt = state.pendingThumb;
    if (!thumbsMap().has(id) && pt && Date.now() - pt.at < 120000 && (!pt.text || t.includes(pt.text.slice(0, 40)))) {
      rememberThumb(id, pt.url);
      state.pendingThumb = null;
    }
    imgs = thumbsMap().get(id) || [];
  }
  const ut = kind === 'userMessage' && imgs.length ? t.replace(/\s*\[Image #\d+\]/g, '').trim() : t;
  if (imgs.length) body.append(renderImages(imgs));
  if (ut) {
    if (isTool) {
      if (looksLikeDiff(t)) body.append(renderDiff(t));
      else {
        const pre = document.createElement('pre');
        pre.className = 'out';
        pre.textContent = t;
        body.append(pre);
      }
    } else if (kind === 'userMessage' && ut.length > 600 && !state.expanded.has(id)) {
      const rich = renderRich(ut, true);
      rich.classList.add('clamp');
      body.append(rich);
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more-btn';
      more.textContent = 'Ver más';
      more.addEventListener('click', () => { state.expanded.add(id); renderItem(state.items.get(id) || item); });
      body.append(more);
    } else {
      body.append(renderRich(ut, kind === 'userMessage'));
    }
  }
  if ((kind === 'subagent' || kind === 'reminderChild') && (item.childSessionId || item.agentPath || item.reminderAgentId || item.fallbackText)) {
    const pre = document.createElement('pre');
    pre.textContent = `hijo ${item.reminderAgentId || item.agentPath || ''} ${item.status || ''} ${item.fallbackText || ''} ${item.childSessionId || ''}`.trim();
    body.append(pre);
  }
  if (kind === 'workflow' && Array.isArray(item.children)) {
    const pre = document.createElement('pre');
    pre.textContent = item.children.map((c) => `${c.childId || c.id || '?'}: ${c.status || c.state || ''}`).join('\n');
    body.append(pre);
  }
  if (!body.textContent) {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(item, null, 1).slice(0, 1500);
    body.append(pre);
  }
  if (state.fullOutputs.has(id)) {
    const pre = document.createElement('pre');
    pre.textContent = state.fullOutputs.get(id);
    body.append(pre);
  }
  if (item.outputRef && !state.fullOutputs.has(id)) {
    acts.append(msgButton('Ver completo', async () => {
      const r = await rpc('item/readOutput', { itemId: item.itemId });
      state.fullOutputs.set(id, String((r && (r.output || r.text)) || JSON.stringify(r).slice(0, 6000)));
      renderItem(state.items.get(id) || item);
    }));
  }
  if (kind === 'subagent' && item.subagentId) {
    const sid = item.subagentId;
    acts.append(msgButton('Mensaje', async () => {
      const txt = await ask({ title: 'Mensaje al subagente', input: 'textarea', okLabel: 'Enviar' });
      if (!txt || !txt.trim()) return;
      await rpc('subagent/sendMessage', { commandId: await newCommandId(), sessionId: state.sessionId, subagentId: sid, body: txt.trim() });
      toast('Mensaje enviado', 'info');
    }));
    acts.append(msgButton('Seguimiento', async () => {
      const txt = await ask({ title: 'Tarea de seguimiento', input: 'textarea', okLabel: 'Enviar' });
      if (!txt || !txt.trim()) return;
      await rpc('subagent/followupTask', { commandId: await newCommandId(), sessionId: state.sessionId, subagentId: sid, body: txt.trim() });
      toast('Tarea enviada', 'info');
    }));
    acts.append(msgButton('Detener', async () => {
      if (!(await ask({ title: '¿Detener subagente?', okLabel: 'Detener', danger: true }))) return;
      await rpc('subagent/stop', { commandId: await newCommandId(), sessionId: state.sessionId, subagentId: sid });
    }));
  }
  if (kind === 'toolCall' && item.itemId && !isFinished(item.status)) {
    const tid = item.itemId;
    acts.append(msgButton('Pasar a fondo', async () => {
      await rpc('task/background', { commandId: await newCommandId(), sessionId: state.sessionId, taskId: tid });
      toast('Tarea en segundo plano', 'info');
    }));
    acts.append(msgButton('Detener tarea', async () => {
      await rpc('task/stop', { commandId: await newCommandId(), sessionId: state.sessionId, taskId: tid });
    }));
  }
  if (acts.children.length) body.append(acts);

  const statusChip = () => {
    if (!item.status) return null;
    const c = document.createElement('span');
    c.className = 'status-chip';
    c.dataset.s = item.status;
    c.textContent = statusText(item.status);
    return c;
  };
  if (COLLAPSIBLE.has(kind)) {
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    const lab = document.createElement('span');
    lab.className = 'sum-txt';
    const base = KIND_LABEL[kind] || kind;
    const title = document.createElement('span');
    title.className = 'sum-title';
    title.textContent = kind === 'toolCall' ? labelFor(item) : base;
    lab.append(title);
    if (tv && tv.summary) {
      const det2 = document.createElement('span');
      det2.className = 'sum-detail';
      det2.textContent = tv.summary;
      lab.append(det2);
    }
    sum.append(icon('chevron'), lab);
    if (tv && (tv.add || tv.del)) {
      const ds = document.createElement('span');
      ds.className = 'diff-stat';
      ds.setAttribute('aria-label', `${tv.add} líneas añadidas, ${tv.del} eliminadas`);
      const ad = document.createElement('span');
      ad.className = 'd-add';
      ad.textContent = '+' + tv.add;
      const de = document.createElement('span');
      de.className = 'd-del';
      de.textContent = '−' + tv.del;
      ds.append(ad, de);
      sum.append(ds);
    }
    const sc = statusChip();
    if (sc) sum.append(sc);
    const inner = document.createElement('div');
    inner.className = 'det-body';
    inner.append(body);
    det.append(sum, inner);
    if (prevOpen[0]) det.open = true;
    host.append(det);
  } else {
    k.textContent = labelFor(item);
    const sc = statusChip();
    if (sc) k.append(sc);
    host.append(k, body);
    if (kind === 'agentMessage' && t) {
      const bar = document.createElement('div');
      bar.className = 'msg-actions';
      const cp = document.createElement('button');
      cp.type = 'button';
      cp.className = 'icon-btn';
      cp.setAttribute('aria-label', 'Copiar respuesta');
      cp.append(icon('copy'));
      cp.addEventListener('click', () => copyText(textOf(state.items.get(id) || item)));
      bar.append(cp);
      host.append(bar);
    }
  }
  if (!li) appendToTranscript(host);
  // Hijos internos del sistema (reminderChild): ocultos salvo toggle.
  const hide = kind === 'reminderChild' && !state.showSys;
  host.classList.toggle('hidden', hide);
  updateSysBtn();
  if (!hide) $('chatEmpty').classList.add('hidden');
  return !li && !hide;
}
function updateSysBtn() {
  const b = $('sysBtn');
  if (!b) return;
  let n = 0;
  for (const it of state.items.values()) if (it.kind === 'reminderChild') n++;
  b.setAttribute('aria-pressed', state.showSys ? 'true' : 'false');
  b.textContent = 'Mensajes de sistema' + (n ? ` (${n})` : '');
}

// Los mensajes pendientes de envio quedan siempre al final.
function appendToTranscript(el) {
  const tr = $('transcript');
  const firstPending = tr.querySelector('li.pending');
  if (firstPending) tr.insertBefore(el, firstPending); else tr.append(el);
}
function renderOutbox() {
  const tr = $('transcript');
  if (!tr) return;
  for (const el of tr.querySelectorAll('li.pending')) el.remove();
  if (!state.sessionId) return;
  for (const e of outboxFor(state.sessionId)) {
    const li = document.createElement('li');
    li.className = 'msg pending msg-enter';
    li.dataset.kind = 'userMessage';
    li.dataset.ob = e.id;
    const k = document.createElement('span');
    k.className = 'kind';
    k.textContent = 'Tú';
    const body = renderRich(e.text || '', true);
    const foot = document.createElement('div');
    foot.className = 'pending-foot';
    const st = document.createElement('span');
    st.textContent = e.error ? 'No enviado: ' + e.error : (state.flushing ? 'Enviando…' : 'Pendiente · se enviará al reconectar');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Reintentar';
    retry.disabled = state.flushing;
    retry.addEventListener('click', () => flushOutbox(true));
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Eliminar';
    del.addEventListener('click', () => { outboxRemove(e.id); renderOutbox(); updateEmpty(); });
    foot.append(st, retry, del);
    li.append(k, body, foot);
    tr.append(li);
  }
  updateEmpty();
}
async function flushOutbox(manual) {
  if (state.flushing || !state.sessionId || !state.token) return;
  const sid = state.sessionId;
  const list = outboxFor(sid);
  if (!list.length) return;
  state.flushing = true;
  renderOutbox();
  let sent = 0;
  try {
    for (const e of list) {
      try {
        if (!e.commandId) { e.commandId = await newCommandId(); outboxUpdate(e); }
        await startTurn(e);
        outboxRemove(e.id);
        sent++;
      } catch (err) {
        if (!isRetryable(err)) { e.error = err.message; outboxUpdate(e); }
        if (manual) toast('No se pudo enviar: ' + err.message);
        break;
      }
      if (state.sessionId !== sid) break;
    }
  } finally {
    state.flushing = false;
    renderOutbox();
  }
  if (sent) { toast(sent === 1 ? 'Mensaje pendiente enviado' : `${sent} mensajes pendientes enviados`, 'info'); state.lastSendAt = Date.now(); }
}

// Avisos en la conversacion (turno fallido, detenido, duracion).
function addNotice(kind, text) {
  const li = document.createElement('li');
  li.className = 'notice msg-enter';
  li.dataset.notice = kind;
  li.textContent = text;
  const stick = isNearBottom();
  appendToTranscript(li);
  afterRender(stick, stick ? 0 : 1);
}
// Indicador "trabajando" con cronometro y ultima actividad (como Codex/Claude).
let workTimer = null;
function updateWorking() {
  const el = $('working');
  if (!el) return;
  const on = !!(state.sessionId && state.running && !pendingCount());
  const wasHidden = el.classList.contains('hidden');
  el.classList.toggle('hidden', !on);
  if (!on) { clearInterval(workTimer); workTimer = null; return; }
  if (!state.turnStartedAt) state.turnStartedAt = Date.now();
  const tick = () => {
    $('workingTxt').textContent = (state.activity || 'Trabajando') + '…';
    $('workingTime').textContent = fmtElapsed(Date.now() - state.turnStartedAt);
  };
  tick();
  if (!workTimer) workTimer = setInterval(tick, 1000);
  if (wasHidden && isNearBottom()) raf(() => scrollToBottom(false));
}
function setActivity(item) {
  if (!item) return;
  const done = /complet|succe|done|fail|error|cancel/i.test(item.status || '');
  if (item.kind === 'toolCall' && !done) state.activity = 'Usando ' + (item.toolName || 'herramienta');
  else if (item.kind === 'userShell' && !done) state.activity = 'Ejecutando comando';
  else if (item.kind === 'reasoning') state.activity = 'Pensando';
  else if (item.kind === 'agentMessage') state.activity = 'Escribiendo';
  else if (item.kind === 'subagent' && !done) state.activity = 'Subagente trabajando';
  else return;
  updateWorking();
}
// Notificaciones del sistema cuando la app esta en segundo plano.
function notify(title, body, tag) {
  // Con Web Push activo el backend ya avisa (y el SW evita duplicados).
  if (!state.notify || state.pushOn || !document.hidden) return;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: String(body || '').slice(0, 180), tag: tag || 'muse', icon: '/icon.svg', badge: '/icon.svg', renotify: true, data: { sessionId: state.sessionId } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(() => {});
    } else {
      new Notification(title, opts); // eslint-disable-line no-new
    }
  } catch { /* sin soporte */ }
}
function updateBadge() {
  try {
    const n = pendingCount();
    if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); }
  } catch {}
}
function syncNotifyBtn() {
  const b = $('notifyBtn');
  if (!b) return;
  b.setAttribute('aria-pressed', state.notify ? 'true' : 'false');
  b.textContent = state.notify ? 'Notificaciones: sí' : 'Notificaciones';
}
// Banner persistente de conexion (en vez de toasts repetidos).
function setBanner(text) {
  const b = $('netBanner');
  if (!b) return;
  if (!text) { b.classList.add('hidden'); return; }
  $('netBannerTxt').textContent = text;
  b.classList.remove('hidden');
}
function updateEmpty() {
  const empty = !!state.sessionId && !$('transcript').querySelector('li:not(.hidden)') && !state.running && !pendingCount();
  $('chatEmpty').classList.toggle('hidden', !empty);
}

// Render por lotes: muchos deltas por segundo -> un repintado por frame.
const renderQueue = new Map();
let renderPending = false;
function queueRender(item) {
  renderQueue.set(item.itemId, item);
  if (renderPending) return;
  renderPending = true;
  raf(flushRenders);
}
function flushRenders() {
  renderPending = false;
  if (!renderQueue.size) return;
  const stick = isNearBottom() || state.followUntil > Date.now();
  let added = 0;
  for (const it of renderQueue.values()) if (renderItem(it)) added++;
  renderQueue.clear();
  afterRender(stick, added);
}
function isNearBottom() {
  const el = document.scrollingElement || document.documentElement;
  return window.innerHeight + window.scrollY >= el.scrollHeight - 140;
}
function scrollToBottom(smooth) {
  const el = document.scrollingElement || document.documentElement;
  // Durante un scroll suave isNearBottom() da falso: seguir pegado un instante.
  if (smooth) state.followUntil = Date.now() + 800;
  window.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
  state.unread = 0;
  updateJump(false);
}
function afterRender(stick, added) {
  if (stick) scrollToBottom(false);
  else if (added) { state.unread += added; updateJump(true); }
}
function updateJump(visible) {
  const j = $('jumpBtn');
  if (!j) return;
  j.hidden = !visible;
  const c = $('jumpCount');
  c.textContent = state.unread > 99 ? '99+' : String(state.unread);
  c.classList.toggle('hidden', !state.unread);
  j.setAttribute('aria-label', state.unread ? `Ir al final: ${state.unread} mensajes nuevos` : 'Ir al final de la conversación');
}

function applyViewEvent(method, p) {
  if (!p) return;
  if (p.viewCursor) state.viewCursor = p.viewCursor;
  switch (method) {
    case 'item/started':
    case 'item/updated':
    case 'item/completed':
      if (p.item && p.item.itemId) {
        const prev = state.items.get(p.item.itemId);
        // Conservar texto acumulado por deltas si el item final no lo trae.
        const merged = prev && prev.text && p.item.text === undefined ? Object.assign({}, p.item, { text: prev.text }) : p.item;
        state.items.set(p.item.itemId, merged);
        queueRender(merged);
        if (state.running) setActivity(merged);
        if (method === 'item/completed' && merged.kind === 'agentMessage') {
          const t = textOf(merged);
          if (t) announce('Muse: ' + t.slice(0, 280));
        }
      }
      break;
    case 'item/delta': {
      if (!p.itemId) break;
      const cur = Object.assign({}, state.items.get(p.itemId) || { itemId: p.itemId, kind: 'agentMessage', text: '' });
      const field = p.field || 'text';
      if (field === 'text' || field.startsWith('summary')) cur.text = (cur.text || '') + (p.delta || '');
      else cur[field] = (cur[field] || '') + (p.delta || '');
      state.items.set(p.itemId, cur);
      queueRender(cur);
      if (state.running && state.activity !== 'Escribiendo' && cur.kind === 'agentMessage') setActivity(cur);
      break;
    }
    case 'turn/started':
      state.running = true; state.turnId = p.turnId || null;
      state.turnStartedAt = Date.now();
      state.activity = 'Pensando';
      if (state.queuedTurnId && p.turnId === state.queuedTurnId) setQueued(null);
      settleStatus();
      break;
    case 'turn/completed':
    case 'turn/retracted':
    case 'turn/unqueued':
      // Un turno encolado que termina/se retira no detiene el turno vivo.
      if (method !== 'turn/unqueued' && (!p.turnId || !state.turnId || p.turnId === state.turnId)) {
        const started = state.turnStartedAt;
        state.running = false;
        state.turnId = null;
        state.turnStartedAt = 0;
        state.activity = '';
        if (method === 'turn/completed') turnOutcome(p, started);
      }
      if (state.queuedTurnId && p.turnId === state.queuedTurnId) setQueued(null);
      settleStatus();
      break;
    case 'session/statusChanged': {
      const s = liveStatus(p);
      state.running = p.status === 'running';
      setStatus(s === 'waiting' || pendingCount() ? 'waiting' : s);
      break;
    }
    case 'approval/requested':
    case 'approval/request':
      renderApproval(p); settleStatus();
      break;
    case 'approval/resolved':
      removeApproval(p.approvalId); settleStatus();
      break;
    case 'userInput/requested':
    case 'userInput/request':
      renderUserInput(p); settleStatus();
      break;
    case 'userInput/settled':
      if (p.userInputId) removeCard(`[data-ui="${CSS.escape(p.userInputId)}"]`);
      settleStatus();
      break;
    case 'session/modelChanged':
      if (p.modelId) { $('modelSel').value = p.modelId; commitSelect($('modelSel')); updateChips(); }
      break;
    case 'session/approvalModeChanged':
      if (p.mode) { $('approvalSel').value = p.mode; commitSelect($('approvalSel')); }
      break;
    default:
      break;
  }
}
// Resultado del turno: aviso de error/detenido o duracion, y notificacion.
function turnOutcome(p, started) {
  const turn = p.turn || {};
  const st = String(p.status || p.outcome || turn.status || turn.outcome || '');
  const e = p.error || turn.error;
  const errMsg = e ? String(e.message || e) : '';
  if (errMsg || /fail|error/i.test(st)) {
    addNotice('error', 'El turno falló' + (errMsg ? ': ' + errMsg : ''));
    notify('El turno de Muse falló', errMsg || 'Abre la sesión para ver el detalle', 'turn');
    return;
  }
  if (/cancel|interrupt|abort|stopp/i.test(st)) {
    addNotice('info', 'Turno detenido');
    return;
  }
  if (started && Date.now() - started > 3000) addNotice('done', 'Trabajó ' + fmtElapsed(Date.now() - started));
  let last = '';
  for (const it of state.items.values()) if (it.kind === 'agentMessage') last = textOf(it);
  notify('Muse terminó', last || 'El turno ha terminado', 'turn');
  if (document.hidden) vibrate(30);
}
function pendingCount() { return $('approvals').querySelectorAll('.approval:not(.leaving)').length; }
function liveStatus(p) {
  if ((p.attention && p.attention.length) || (p.pendingRequests && p.pendingRequests.length)) return 'waiting';
  return p.status === 'running' ? 'running' : 'idle';
}

// ---- approvals ----
function removeCard(selector) {
  const el = document.querySelector(selector);
  if (!el || el.classList.contains('leaving')) return;
  if (prefersReducedMotion()) { el.remove(); return; }
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 220);
}
function newCardAlert(text) {
  vibrate([20, 60, 20]);
  announce(text);
  // Justo tras enviar, la respuesta (y sus aprobaciones) se sigue siempre.
  if (isNearBottom() || Date.now() - (state.lastSendAt || 0) < 20000) raf(() => scrollToBottom(true));
  else updateJump(true);
}
function renderApproval(p) {
  if (!p || !p.approvalId || document.querySelector(`[data-appr="${CSS.escape(p.approvalId)}"]`)) return;
  const div = document.createElement('div');
  div.className = 'approval';
  div.dataset.appr = p.approvalId;
  div.setAttribute('role', 'group');
  const title = document.createElement('h3');
  const what = p.toolName || (p.subject && p.subject.kind) || '';
  title.textContent = 'Aprobación requerida' + (what ? ` · ${what}` : '');
  const id = 'appr-' + p.approvalId.replace(/[^\w-]/g, '');
  title.id = id;
  div.setAttribute('aria-labelledby', id);
  const descTxt = (p.subject && (p.subject.command || p.subject.path || p.rawArgs)) || p.rawArgs || '';
  div.append(title);
  if (descTxt) {
    const desc = document.createElement('pre');
    desc.textContent = typeof descTxt === 'string' ? descTxt : JSON.stringify(descTxt, null, 1);
    div.append(desc);
  }
  const btns = document.createElement('div');
  btns.className = 'btns';
  (p.availableChoices || []).forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (i === 0 ? 'btn-primary' : 'btn-ghost');
    const sp = document.createElement('span');
    sp.className = 'spinner';
    sp.setAttribute('aria-hidden', 'true');
    b.append(sp, document.createTextNode(c.label || c.choiceId));
    b.addEventListener('click', () => decideApproval(p, c.choiceId, div, b));
    btns.append(b);
  });
  div.append(btns);
  $('approvals').append(div);
  newCardAlert('Aprobación requerida' + (what ? ': ' + what : ''));
  notify('Aprobación requerida' + (what ? ' · ' + what : ''), typeof descTxt === 'string' ? descTxt : 'Muse necesita tu permiso', 'appr-' + p.approvalId);
}
async function decideApproval(p, choiceId, div, btn) {
  const all = div ? Array.from(div.querySelectorAll('button')) : [];
  all.forEach((b) => { b.disabled = true; });
  if (btn) btn.classList.add('is-loading');
  try {
    await rpc('approval/decide', {
      approvalId: p.approvalId, choiceId, commandId: await newCommandId(),
      requirementId: p.currentRequirementId, sessionId: state.sessionId,
    });
    // En modo poll no llega approval/resolved: retirar ya la tarjeta.
    removeApproval(p.approvalId);
    settleStatus();
  } catch (e) {
    all.forEach((b) => { b.disabled = false; });
    if (btn) btn.classList.remove('is-loading');
    toast('Error al decidir: ' + e.message);
  }
}
function removeApproval(id) {
  removeCard(`[data-appr="${CSS.escape(id || '')}"]`);
}
function renderUserInput(p) {
  if (!p || !p.userInputId || document.querySelector(`[data-ui="${CSS.escape(p.userInputId)}"]`)) return;
  const uid = String(p.userInputId).replace(/[^\w-]/g, '');
  const div = document.createElement('div');
  div.className = 'approval';
  div.dataset.ui = p.userInputId;
  div.setAttribute('role', 'group');
  const t = document.createElement('h3');
  t.id = 'ui-' + uid;
  t.textContent = 'Muse pregunta' + (p.toolName ? ` · ${p.toolName}` : '');
  div.setAttribute('aria-labelledby', t.id);
  div.append(t);
  const answers = [];
  (p.questions || []).forEach((q, qi) => {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = (q.header ? q.header + ': ' : '') + (q.question || '');
    fs.append(lg);
    const sel = q.selection || {};
    const mode = sel.mode === 'multiple' ? 'multiple' : 'single';
    const picked = { mode, inputs: [] };
    for (const o of q.options || []) {
      const lab = document.createElement('label');
      lab.className = 'opt';
      const inp = document.createElement('input');
      inp.type = mode === 'multiple' ? 'checkbox' : 'radio';
      inp.name = `ui_${uid}_${q.id || qi}`;
      inp.value = o.label;
      picked.inputs.push(inp);
      const span = document.createElement('span');
      span.textContent = o.label;
      if (o.description) {
        const sm = document.createElement('small');
        sm.textContent = o.description;
        span.append(sm);
      }
      lab.append(inp, span);
      fs.append(lab);
    }
    const free = document.createElement('input');
    free.type = 'text';
    free.placeholder = q.options && q.options.length ? 'O escribe tu respuesta' : 'Tu respuesta';
    free.setAttribute('aria-label', 'Respuesta libre: ' + (q.question || q.header || ''));
    free.maxLength = 500;
    fs.append(free);
    div.append(fs);
    answers.push({ q, picked, free });
  });
  const note = document.createElement('input');
  note.type = 'text';
  note.placeholder = 'Nota opcional';
  note.setAttribute('aria-label', 'Nota opcional');
  note.maxLength = 500;
  note.style.marginTop = '.7rem';
  div.append(note);
  const btns = document.createElement('div');
  btns.className = 'btns';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'btn btn-primary';
  const sp = document.createElement('span');
  sp.className = 'spinner';
  sp.setAttribute('aria-hidden', 'true');
  send.append(sp, document.createTextNode('Responder'));
  send.addEventListener('click', async () => {
    try {
      const out = [];
      for (const a of answers) {
        const sel = a.picked.inputs.filter((i) => i.checked).map((i) => i.value);
        const entry = { questionId: a.q.id };
        const qname = a.q.header || a.q.question || a.q.id;
        if (sel.length) {
          if (a.picked.mode === 'multiple') {
            const min = (a.q.selection && a.q.selection.minSelections) || 0;
            const max = (a.q.selection && a.q.selection.maxSelections) || sel.length;
            if (sel.length < min || sel.length > max) throw new Error(`“${qname}”: elige entre ${min} y ${max}`);
            entry.selectedLabels = sel;
          } else {
            entry.selectedLabel = sel[0];
          }
        } else if (a.free.value.trim()) {
          entry.freeText = a.free.value.trim().slice(0, 500);
        } else {
          a.free.focus();
          throw new Error(`“${qname}”: elige una opción o escribe texto`);
        }
        if (note.value.trim()) entry.note = note.value.trim().slice(0, 500);
        out.push(entry);
      }
      setBusy(send, true);
      await rpc('userInput/answer', {
        userInputId: p.userInputId, answers: out,
        commandId: await newCommandId(), sessionId: state.sessionId,
      });
      removeCard(`[data-ui="${CSS.escape(p.userInputId)}"]`);
      settleStatus();
    } catch (e) {
      setBusy(send, false);
      toast(e.message);
    }
  });
  btns.append(send);
  div.append(btns);
  $('approvals').append(div);
  newCardAlert('Muse te hace una pregunta');
  const q0 = (p.questions && p.questions[0]) || {};
  notify('Muse pregunta', q0.question || q0.header || 'Responde para continuar', 'ui-' + p.userInputId);
}
async function refreshPending() {
  const sid = state.sessionId;
  try {
    const r = await rpc('approval/listPending', { sessionId: sid });
    if (sid !== state.sessionId) return;
    for (const a of r.approvals || []) renderApproval(a);
    settleStatus();
  } catch { /* puede no haber pendientes */ }
}

async function refreshApproval(session) {
  const sel = $('approvalSel');
  const mode = (session && session.approvalMode && session.approvalMode.mode) || '';
  if (mode) sel.value = mode;
  else sel.selectedIndex = 0;
  commitSelect(sel);
}
async function refreshSkills() {
  const sel = $('skillSel');
  const sid = state.sessionId;
  try {
    const r = await rpc('skill/list', { sessionId: sid });
    if (sid !== state.sessionId) return;
    sel.innerHTML = '<option value="">(ninguna)</option>';
    for (const s of (r && r.skills) || []) {
      const o = document.createElement('option');
      o.value = s.selector || s.name;
      o.textContent = s.displayName || s.selector || s.name;
      o.title = s.description || '';
      sel.append(o);
    }
  } catch { /* skills no disponibles: se envia como texto */ }
  updateChips();
}

// ---- toast ----
let toastTimer = null;
// kind: 'error' (por defecto) | 'warn' | 'info'
function toast(msg, kind) {
  const t = $('toast');
  if (!t) return;
  const k = kind || 'error';
  t.dataset.kind = k;
  t.textContent = msg;
  t.classList.remove('hidden', 'leaving');
  // Reiniciar animacion de entrada al reemplazar un toast visible.
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, k === 'error' ? 6000 : 3200);
}
function hideToast() {
  const t = $('toast');
  if (!t || t.classList.contains('hidden')) return;
  clearTimeout(toastTimer);
  if (prefersReducedMotion()) { t.classList.add('hidden'); return; }
  t.classList.add('leaving');
  setTimeout(() => { if (t.classList.contains('leaving')) t.classList.add('hidden'); }, 200);
}

// ---- modelos / effort ----
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
  commitSelect(sel);
  updateChips();
}
// Valor confirmado por el servidor: si un cambio falla, el select vuelve aqui.
function commitSelect(sel) { sel.dataset.prev = sel.value; }
async function fetchCatalog() {
  // Con sessionId para marcar el activo; sin el como fallback.
  try {
    if (state.sessionId) {
      const cat = await rpc('model/list', { sessionId: state.sessionId });
      if (cat.models && cat.models.length) return cat;
    }
  } catch { /* sesion no cargada en este host: fallback sin sessionId */ }
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
    toast('No se pudo cargar el catálogo de modelos: ' + e.message, 'warn');
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
  const first = !state.pollMode;
  state.pollMode = true;
  setConnState('waiting');
  setConnDetail('poll: ' + (reason || 'sin live tail'));
  netinfo('Modo poll: ' + (reason || 'sin directo en vivo'));
  if (first) toast('Sesión sin directo en vivo — se actualiza cada 10 s', 'info');
  const sid = state.sessionId;
  const tick = async () => {
    if (!state.sessionId || state.sessionId !== sid || !state.pollMode) return;
    if (document.hidden) return; // sin trafico en segundo plano
    try {
      const res = await rpc('session/read', { sessionId: sid });
      if (state.sessionId !== sid || !state.pollMode) return;
      if (res.viewCursor) state.viewCursor = res.viewCursor;
      const stick = isNearBottom();
      const added = renderHistory(res.history) || 0;
      afterRender(stick, added);
      if (res.session) {
        state.running = res.session.status === 'running';
        settleStatus();
        if (res.session.modelId && $('modelSel').value !== res.session.modelId) {
          try { await refreshModels(res.session); } catch {}
        }
        try { await refreshApproval(res.session); } catch {}
      }
      noteAlive();
      if (outboxFor(sid).length) flushOutbox(false);
    } catch (e) {
      setConnDetail('poll error: ' + e.message);
    }
  };
  state.pollTick = tick;
  tick();
  state.pollTimer = setInterval(tick, 10000);
}
function exitPollMode() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.pollTick = null;
  state.pollMode = false;
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
      if (!handle.closed) handlers.failure('http ' + r.status, r.status);
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
        // Normalizar CRLF: algunos proxies reescriben los finales de linea.
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = parseFrame(frame);
          if (ev && !handle.closed) handlers.event(ev.type, ev.data);
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
  if (!state.sessionId || !state.token) return;
  noteAlive(); // el watchdog cuenta desde ahora, no desde el ultimo stream
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
      setBanner(null);
      if (outboxFor(state.sessionId).length) setTimeout(() => flushOutbox(false), 300);
      setConn(true); state.esFails = 0;
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
      try {
        if (d.__bridge === 'host-down') { setConn(false); setBanner('Muse se está reiniciando…'); }
        // Host reiniciado: el stream actual ya no recibe la vista -> re-suscribir.
        if (d.__bridge === 'host-up') scheduleReconnect(myGen, 500);
      } catch {}
      return;
    }
    applyViewEvent(type, d.params || d);
  };
  const failure = (reason, status) => {
    if (myGen !== esGen) return;
    if (state.es) { try { state.es.close(); } catch {} state.es = null; }
    if (status === 401) { onUnauthorized(); return; }
    setConn(false);
    state.esFails = (state.esFails || 0) + 1;
    const info = reason + ' · intento #' + state.esFails;
    setConnDetail(info);
    netinfo('SSE: ' + info);
    setBanner(navigator.onLine === false ? 'Sin conexión de red — reintentando…' : 'Conexión en vivo perdida — reconectando…');
    scheduleReconnect(myGen, Math.min(30000, 2000 * state.esFails));
  };
  state.es = streamEvents(url, myGen, {
    open: () => { if (myGen === esGen) setConn(true); },
    event: forward,
    failure,
  }, authHeader);
}
// Watchdog: si el proxy intermedio mata el stream en silencio, re-suscribe
// gapless con after=cursor (el servidor reemite lo perdido). En modo poll no
// aplica (el poll ya refresca) y evita un bucle SSE->error->poll.
const watchdog = setInterval(() => {
  if (state.sessionId && !state.pollMode && !state.esRetry && state.lastEventAt && Date.now() - state.lastEventAt > 65000) {
    connectEvents();
  }
}, 10000);
if (watchdog && watchdog.unref) watchdog.unref(); // solo node (tests): no retener el runner

// ---- composer ----
function setQueued(tid) {
  state.queuedTurnId = tid || null;
  $('unqueueBtn').classList.toggle('hidden', !tid);
  updateChips();
}
function clearImage() {
  state.pendingImage = null;
  const fi = $('fileInput');
  if (fi) fi.value = '';
  const pv = $('imgPreview');
  if (pv) { pv.innerHTML = ''; pv.classList.add('hidden'); }
  updateSendState();
}
function updateSendState() {
  const ta = $('promptInput');
  const sb = $('sendBtn');
  if (!ta || !sb) return;
  sb.disabled = state.sending || (!ta.value.trim() && !state.pendingImage);
  sb.classList.toggle('is-loading', state.sending);
}
function autoGrow() {
  const ta = $('promptInput');
  ta.style.height = 'auto';
  if (!ta.value) return; // vacio: altura natural (el placeholder no cuenta)
  ta.style.height = Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}
function draftKey() { return state.sessionId ? 'muse-remote-draft:' + state.sessionId : null; }
let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  const k = draftKey();
  if (k) store(k, $('promptInput').value);
}
function restoreDraft() {
  const ta = $('promptInput');
  if (state.sharedText) { ta.value = state.sharedText; state.sharedText = null; }
  else ta.value = recall(draftKey()) || '';
  autoGrow();
  updateSendState();
}
function updateChips() {
  const box = $('chips');
  if (!box) return;
  box.innerHTML = '';
  const skillSel = $('skillSel');
  const busy = $('busySel').value;
  const add = (text, label, onClear, cls, ic) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip' + (cls ? ' ' + cls : '');
    c.setAttribute('aria-label', label);
    c.append(document.createTextNode(text), icon(ic || 'close'));
    c.addEventListener('click', onClear);
    box.append(c);
  };
  // Modelo/esfuerzo siempre a la vista (abre las opciones), como Codex.
  const ms = $('modelSel');
  const mName = ms.selectedIndex >= 0 && ms.value ? ms.options[ms.selectedIndex].textContent : '';
  const eff = $('effortSel').value;
  if (mName) {
    const txt = mName + (eff ? ' · ' + eff : '');
    add(txt, 'Modelo ' + txt + '. Abrir opciones de la sesión', () => $('menuBtn').click(), 'chip-meta', 'chevron');
  }
  if (state.queuedTurnId) {
    add('1 en cola · Desencolar', 'Desencolar el mensaje en cola', () => $('unqueueBtn').click(), 'chip-warn');
  }
  if (skillSel.value) {
    const name = skillSel.options[skillSel.selectedIndex].textContent;
    add('Skill: ' + name, 'Quitar skill ' + name, () => { skillSel.value = ''; updateChips(); });
  }
  if (busy !== 'queue') {
    const name = $('busySel').options[$('busySel').selectedIndex].textContent;
    add('Si ocupado: ' + name, 'Volver a encolar si está ocupado', () => { $('busySel').value = 'queue'; updateChips(); });
  }
  box.classList.toggle('hidden', !box.children.length);
}
// ---- comandos "/" (skills + acciones) ----
const SLASH_COMMANDS = [
  { id: 'compactar', desc: 'Compactar el contexto', btn: 'compactBtn' },
  { id: 'duplicar', desc: 'Duplicar la sesión', btn: 'forkBtn' },
  { id: 'historial', desc: 'Cargar historial completo', btn: 'historyBtn' },
  { id: 'detener', desc: 'Detener el turno en curso', btn: 'cancelBtn' },
  { id: 'shell', desc: 'Ejecutar un comando: /shell <cmd>', arg: true },
];
// Sugerencias para el texto actual del composer (solo "/palabra" sin espacio).
function slashMatches(text, skills) {
  const m = /^\/([^\s]*)$/.exec(String(text || ''));
  if (!m) return [];
  const q = m[1].toLowerCase();
  const out = [];
  for (const c of SLASH_COMMANDS) if (c.id.startsWith(q)) out.push({ type: 'cmd', id: c.id, label: '/' + c.id, desc: c.desc, arg: !!c.arg });
  for (const sk of skills || []) {
    const hay = (sk.id + ' ' + (sk.label || '')).toLowerCase();
    if (!q || hay.includes(q)) out.push({ type: 'skill', id: sk.id, label: '/' + sk.id, desc: sk.label && sk.label !== sk.id ? sk.label : 'Skill' });
  }
  return out.slice(0, 8);
}
// "/shell ls -la" -> {cmd:'shell', arg:'ls -la'}; solo comandos conocidos.
function parseSlash(text) {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const c = SLASH_COMMANDS.find((x) => x.id === m[1].toLowerCase());
  return c ? { cmd: c.id, arg: (m[2] || '').trim() } : null;
}
function skillList() {
  return Array.from($('skillSel').options).filter((o) => o.value).map((o) => ({ id: o.value, label: o.textContent }));
}
function runSlash(cmd, arg) {
  const c = SLASH_COMMANDS.find((x) => x.id === cmd);
  if (!c) return false;
  if (c.id === 'shell') {
    if (!arg) { toast('Uso: /shell <comando>', 'warn'); return true; }
    $('shellInput').value = arg;
    $('shellForm').requestSubmit();
    return true;
  }
  $(c.btn).click();
  return true;
}
let slashActive = 0;
let slashOpts = [];
function closeSlash() {
  slashOpts = [];
  $('slashMenu').classList.add('hidden');
  const ta = $('promptInput');
  ta.setAttribute('aria-expanded', 'false');
  ta.removeAttribute('aria-activedescendant');
}
function updateSlash() {
  const ta = $('promptInput');
  slashOpts = slashMatches(ta.value, skillList());
  const menu = $('slashMenu');
  if (!slashOpts.length) { closeSlash(); return; }
  slashActive = Math.min(slashActive, slashOpts.length - 1);
  menu.innerHTML = '';
  slashOpts.forEach((o, i) => {
    const li = document.createElement('li');
    li.id = 'slash-' + i;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === slashActive ? 'true' : 'false');
    const a = document.createElement('strong');
    a.textContent = o.label;
    const d = document.createElement('span');
    d.textContent = o.desc;
    li.append(a, d);
    li.addEventListener('pointerdown', (e) => { e.preventDefault(); chooseSlash(i); });
    menu.append(li);
  });
  menu.classList.remove('hidden');
  ta.setAttribute('aria-expanded', 'true');
  ta.setAttribute('aria-activedescendant', 'slash-' + slashActive);
}
function chooseSlash(i) {
  const o = slashOpts[i];
  const ta = $('promptInput');
  if (!o) return;
  closeSlash();
  if (o.type === 'skill') {
    $('skillSel').value = o.id;
    ta.value = '';
    updateChips();
    toast('Skill activa: ' + o.id, 'info');
  } else if (o.arg) {
    ta.value = o.label + ' ';
  } else {
    ta.value = '';
    runSlash(o.id, '');
  }
  autoGrow();
  updateSendState();
  ta.focus();
}

// Arranca un turno a partir de una entrada (UI u outbox).
async function startTurn(e) {
  const parts = [];
  if (e.skill) parts.push({ type: 'skill', selector: e.skill, arguments: e.text || '' });
  else if (e.text) parts.push({ type: 'text', text: e.text });
  if (e.image) {
    if (imageBase64TooLarge(e.image.base64Data)) throw new Error('imagen demasiado grande (máx 4 MiB en base64)');
    parts.push({ type: 'image', base64Data: e.image.base64Data, mediaType: e.image.mediaType, width: e.image.width, height: e.image.height });
  }
  if (!parts.length) return null;
  if (!e.commandId) e.commandId = await newCommandId();
  const params = { commandId: e.commandId, sessionId: e.sessionId, input: parts, ifBusy: e.ifBusy || 'queue' };
  if (e.effort) params.reasoningEffort = e.effort;
  return rpc('turn/start', params);
}
async function sendPrompt(text) {
  const im = state.pendingImage;
  const entry = {
    sessionId: state.sessionId, text,
    effort: $('effortSel').value || undefined,
    ifBusy: $('busySel').value || 'queue',
    skill: $('skillSel').value || '',
    image: im ? { base64Data: im.base64Data, mediaType: im.mediaType, width: im.width, height: im.height } : null,
  };
  if (!entry.text && !entry.image) return;
  let ack;
  try {
    ack = await startTurn(entry);
  } catch (err) {
    err.entry = entry;
    throw err;
  }
  if (im && im.thumb) state.pendingThumb = { url: im.thumb, text, at: Date.now() };
  clearImage();
  // Capturar turno encolado para ofrecer Desencolar (ack.turnId != turno live).
  try {
    const tid = ack && (ack.turnId || (ack.turn && ack.turn.turnId));
    const disp = ack && (ack.disposition || (ack.turn && ack.turn.disposition));
    if (tid && (disp === 'queued' || (state.turnId && tid !== state.turnId))) {
      setQueued(tid);
      toast('Mensaje encolado: se enviará al terminar el turno actual', 'info');
    } else {
      setQueued(null);
    }
  } catch {}
  // Un turno nuevo puede materializar la vista en vivo: reintentar salir de poll.
  if (state.pollMode) connectEvents();
}
function attachImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) { toast('Solo se pueden adjuntar imágenes', 'warn'); return; }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const scale = Math.min(1, CLIENT_MAX_IMAGE_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // Fondo blanco: un PNG con transparencia no queda negro en JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = cv.toDataURL('image/jpeg', 0.85);
    const b64 = dataUrl.split(',')[1] || '';
    if (imageBase64TooLarge(b64)) { toast('Imagen demasiado grande tras comprimir (máx 4 MiB)'); return; }
    let thumb = null;
    try { thumb = makeThumb(img, 320); } catch {}
    state.pendingImage = { base64Data: b64, mediaType: 'image/jpeg', width: w, height: h, thumb };
    const pv = $('imgPreview');
    pv.innerHTML = '';
    const th = document.createElement('img');
    th.src = dataUrl;
    th.alt = 'Vista previa de la imagen adjunta';
    const info = document.createElement('span');
    info.className = 'meta-txt';
    info.textContent = `${w}×${h} · ${Math.round(b64.length * 0.75 / 1024)} KB`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn';
    rm.setAttribute('aria-label', 'Quitar imagen adjunta');
    rm.append(icon('close'));
    rm.addEventListener('click', () => { clearImage(); $('promptInput').focus(); });
    pv.append(th, info, rm);
    pv.classList.remove('hidden');
    updateSendState();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('No se pudo leer la imagen'); };
  img.src = url;
}

// ---- tema ----
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}
function syncThemeUi() {
  const cur = effectiveTheme();
  $('themeIcon').setAttribute('href', cur === 'dark' ? '#i-sun' : '#i-moon');
  $('themeBtn').setAttribute('aria-label', cur === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  const color = cur === 'dark' ? '#141b17' : '#ffffff';
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    if (document.documentElement.dataset.theme) m.removeAttribute('media');
    m.setAttribute('content', color);
  }
}

// ---- voz ----
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('El dictado no está soportado en este navegador', 'warn'); return; }
  if (state.rec) { try { state.rec.stop(); } catch {} return; }
  const btn = $('micBtn');
  try {
    const rec = new SR();
    rec.lang = navigator.language || 'es-ES';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const t = ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript;
      if (!t) return;
      const ta = $('promptInput');
      ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + t;
      autoGrow(); updateSendState(); saveDraft();
    };
    rec.onerror = (ev) => {
      if (ev && ev.error === 'not-allowed') toast('Permiso de micrófono denegado');
      else if (ev && ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Error de dictado');
    };
    rec.onend = () => {
      state.rec = null;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Dictar por voz');
    };
    rec.start();
    state.rec = rec;
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', 'Detener dictado');
    vibrate(10);
  } catch { state.rec = null; toast('Dictado no disponible'); }
}

// ---- logout ----
function logout() {
  store('muse-remote-token', null);
  store('muse-remote-session', null);
  state.token = '';
  state.sessionId = null;
  state.sessions = null;
  state.openSeq++;
  stopEvents();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  document.body.classList.remove('modal-open');
  showLogin();
}

// ---- wiring ----
document.addEventListener('DOMContentLoaded', () => {
  // Share Target de Android (?text/?url/?title) -> prefill del composer.
  try {
    const sq = new URLSearchParams(location.search);
    const fromNotif = sq.get('session');
    if (fromNotif) { state.openOnBoot = fromNotif; history.replaceState(null, '', location.pathname); }
    const shared = [sq.get('title'), sq.get('text'), sq.get('url')].filter(Boolean).join('\n');
    if (shared) {
      state.sharedText = shared;
      const ta = $('promptInput');
      if (ta) ta.value = shared;
      history.replaceState(null, '', location.pathname);
    }
  } catch {}
  const root = document.documentElement;
  const savedTheme = recall('muse-remote-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') root.dataset.theme = savedTheme;
  syncThemeUi();
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeUi);
  } catch {}
  $('themeBtn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store('muse-remote-theme', next);
    syncThemeUi();
  });
  try { state.showSys = recall('muse-remote-show-sys') === '1'; } catch {}

  const composer = $('composer');
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      const stick = document.body.dataset.view === 'chatView' && isNearBottom();
      setComposerH();
      if (stick) scrollToBottom(false);
    }).observe(composer);
  }
  setComposerH();

  // Dialogos: cerrar tocando el fondo y con animacion.
  for (const d of [$('sheet'), $('dlg')]) {
    d.addEventListener('click', (e) => { if (e.target === d) closeDialog(d, 'cancel'); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(d, 'cancel'); });
    d.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    });
  }
  $('dlgCancel').addEventListener('click', () => closeDialog($('dlg'), 'cancel'));
  $('dlgForm').addEventListener('submit', (e) => { e.preventDefault(); closeDialog($('dlg'), 'ok'); });
  $('dlgArea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeDialog($('dlg'), 'ok'); }
  });

  // Bottom sheet: abrir, cerrar y deslizar hacia abajo para cerrar.
  const sheet = $('sheet');
  $('menuBtn').addEventListener('click', () => { openDialog(sheet); $('sheetClose').focus(); });
  $('sheetClose').addEventListener('click', () => closeDialog(sheet));
  (() => {
    let y0 = null;
    let dy = 0;
    const start = (e) => { y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; };
    const move = (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 80) closeDialog(sheet);
    };
    for (const el of [sheet.querySelector('.sheet-grab'), sheet.querySelector('.sheet-head')]) {
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchmove', move, { passive: true });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    }
  })();

  $('toast').addEventListener('click', hideToast);

  // Login
  $('tokenToggle').addEventListener('click', () => {
    const inp = $('tokenInput');
    const showIt = inp.type === 'password';
    inp.type = showIt ? 'text' : 'password';
    const b = $('tokenToggle');
    b.setAttribute('aria-pressed', showIt ? 'true' : 'false');
    b.setAttribute('aria-label', showIt ? 'Ocultar token' : 'Mostrar token');
    b.querySelector('use').setAttribute('href', showIt ? '#i-eye-off' : '#i-eye');
  });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginErr');
    err.textContent = '';
    const inp = $('tokenInput');
    const tok = inp.value.trim();
    if (!tok) { err.textContent = 'Falta el token.'; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
    const btn = $('loginBtn');
    setBusy(btn, true);
    try {
      await tryLogin(tok);
      state.token = tok;
      store('muse-remote-token', tok);
      inp.value = '';
      inp.removeAttribute('aria-invalid');
      show('sessionsView');
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      inp.setAttribute('aria-invalid', 'true');
      inp.focus();
    } finally {
      setBusy(btn, false);
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    const ok = await ask({ title: '¿Cerrar sesión?', message: 'Se borrará el token de este dispositivo.', okLabel: 'Cerrar sesión', danger: true });
    if (ok) logout();
  });

  // Sesiones
  $('newBtn').addEventListener('click', async () => {
    const btn = $('newBtn');
    const ws = await ask({
      title: 'Nueva sesión',
      message: 'Carpeta de trabajo. Déjala vacía para una sesión sin acceso a archivos.',
      input: 'text', value: recall('muse-remote-ws') ?? 'C:\\Dev', placeholder: 'C:\\ruta\\al\\proyecto', okLabel: 'Crear',
    });
    if (ws === null) return; // cancelado
    store('muse-remote-ws', ws.trim() || null);
    setBusy(btn, true);
    try {
      const params = { commandId: await newCommandId() };
      if (ws.trim()) params.workspaceRoot = ws.trim();
      const session = await rpc('session/start', params);
      const id = (session && session.session && session.session.sessionId) || (session && session.sessionId);
      if (id) {
        await openSession(id, null, (session && session.session) || { workspaceRoot: params.workspaceRoot, sessionId: id });
        state.sessions = null; // forzar listado fresco al volver
      } else {
        await loadSessions();
      }
    } catch (e) {
      toast('No se pudo crear la sesión: ' + e.message);
    } finally {
      setBusy(btn, false);
    }
  });
  $('refreshBtn').addEventListener('click', () => loadSessions());
  $('hiddenBtn').addEventListener('click', () => {
    state.showHidden = !state.showHidden;
    renderSessions();
  });
  let searchTimer = null;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; renderSessions(); }, 120);
  });
  const setTab = (tab, focus) => {
    state.listTab = tab;
    renderSessions();
    if (focus) $(tab === 'chats' ? 'tabChats' : 'tabEmpty').focus();
  };
  $('tabChats').addEventListener('click', () => setTab('chats'));
  $('tabEmpty').addEventListener('click', () => setTab('empty'));
  // Patron ARIA de pestañas: flechas/Inicio/Fin mueven la seleccion.
  for (const id of ['tabChats', 'tabEmpty']) {
    $(id).addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'Home' ? 'chats' : e.key === 'End' ? 'empty' : (state.listTab === 'chats' ? 'empty' : 'chats');
        setTab(next, true);
      }
    });
  }

  // Navegacion: boton atras de la app y gesto/boton atras del sistema.
  $('backBtn').addEventListener('click', () => {
    if (history.state && history.state.view === 'chat') history.back();
    else leaveChat();
  });
  window.addEventListener('popstate', () => {
    if ($('sheet').open) closeDialog($('sheet'));
    if (document.body.dataset.view === 'chatView') leaveChat();
  });

  // Chat: scroll -> boton "ir al final".
  let scrollPending = false;
  window.addEventListener('scroll', () => {
    if (scrollPending || document.body.dataset.view !== 'chatView') return;
    scrollPending = true;
    raf(() => {
      scrollPending = false;
      const near = isNearBottom();
      if (near) state.unread = 0;
      updateJump(!near);
    });
  }, { passive: true });
  $('jumpBtn').addEventListener('click', () => scrollToBottom(true));

  // Composer
  const ta = $('promptInput');
  ta.setAttribute('aria-autocomplete', 'list');
  ta.setAttribute('aria-controls', 'slashMenu');
  ta.setAttribute('aria-expanded', 'false');
  // Menu "/" con teclado (registrado antes del Enter-para-enviar).
  ta.addEventListener('keydown', (e) => {
    if (!slashOpts.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      slashActive = (slashActive + (e.key === 'ArrowDown' ? 1 : -1) + slashOpts.length) % slashOpts.length;
      updateSlash();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      chooseSlash(slashActive);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSlash();
    }
  });
  ta.addEventListener('blur', () => setTimeout(closeSlash, 150));
  ta.addEventListener('input', () => {
    slashActive = 0;
    updateSlash();
    autoGrow();
    updateSendState();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.key !== 'Enter' || e.isComposing) return;
    // Escritorio: Enter envia y Shift+Enter salta linea. Movil: Enter salta
    // linea (el teclado tactil no tiene Shift comodo). Ctrl/Cmd+Enter siempre envia.
    let fine = false;
    try { fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch {}
    if (e.ctrlKey || e.metaKey || (fine && !e.shiftKey)) {
      e.preventDefault();
      composer.requestSubmit ? composer.requestSubmit() : composer.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  ta.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length && String(files[0].type).startsWith('image/')) {
      e.preventDefault();
      attachImage(files[0]);
    }
  });
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.sending) return; // evita doble envio por doble toque
    const text = ta.value.trim();
    if (!text && !state.pendingImage) return;
    closeSlash();
    const sl = !state.pendingImage && parseSlash(text);
    if (sl) {
      ta.value = '';
      autoGrow();
      updateSendState();
      store(draftKey(), null);
      runSlash(sl.cmd, sl.arg);
      return;
    }
    state.sending = true;
    ta.value = '';
    autoGrow();
    updateSendState();
    try {
      await sendPrompt(text);
      store(draftKey(), null);
      vibrate(8);
      state.lastSendAt = Date.now();
      scrollToBottom(false);
    } catch (err) {
      if (isRetryable(err) && err.entry && !err.entry.image) {
        // Sin conexion: a la cola local, se envia solo al reconectar.
        outboxAdd(err.entry);
        store(draftKey(), null);
        renderOutbox();
        scrollToBottom(false);
        toast('Sin conexión: el mensaje se enviará al reconectar', 'warn');
      } else {
        ta.value = text;
        autoGrow();
        toast('No se pudo enviar: ' + err.message + (err.entry && err.entry.image && isRetryable(err) ? ' (las imágenes no se guardan sin conexión)' : ''));
      }
    } finally {
      state.sending = false;
      updateSendState();
    }
  });
  $('attachBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) attachImage(e.target.files[0]);
  });
  $('micBtn').addEventListener('click', toggleMic);
  $('cancelBtn').addEventListener('click', async () => {
    const b = $('cancelBtn');
    b.disabled = true;
    try {
      const p = { commandId: await newCommandId(), sessionId: state.sessionId };
      if (state.turnId) p.turnId = state.turnId;
      await rpc('turn/interrupt', p);
      toast('Deteniendo turno…', 'info');
    } catch (e) { toast('No se pudo detener: ' + e.message); }
    finally { b.disabled = false; }
  });

  // Ajustes de la sesion: si la llamada falla, el select vuelve a su valor.
  const bindSelect = (id, apply, okMsg) => {
    const sel = $(id);
    commitSelect(sel);
    sel.addEventListener('change', async () => {
      const v = sel.value;
      if (!v) return;
      sel.disabled = true;
      try {
        await apply(v);
        sel.dataset.prev = v;
        toast(okMsg + ': ' + sel.options[sel.selectedIndex].textContent, 'info');
      } catch (err) {
        if (sel.dataset.prev !== undefined) sel.value = sel.dataset.prev;
        toast('Error: ' + err.message);
      } finally { sel.disabled = false; }
    });
  };
  bindSelect('modelSel', async (v) => rpc('session/setModel', {
    commandId: await newCommandId(), sessionId: state.sessionId, model: { modelId: v },
  }), 'Modelo');
  bindSelect('effortSel', async (v) => rpc('session/setReasoningEffort', {
    commandId: await newCommandId(), sessionId: state.sessionId, reasoningEffort: v,
  }), 'Esfuerzo');
  bindSelect('approvalSel', async (v) => rpc('session/setApprovalMode', {
    commandId: await newCommandId(), sessionId: state.sessionId, mode: v,
  }), 'Aprobación');
  $('skillSel').addEventListener('change', updateChips);
  $('effortSel').addEventListener('change', updateChips);
  $('busySel').addEventListener('change', updateChips);

  // Acciones del sheet
  const sheetAction = (id, fn) => {
    const b = $(id);
    b.addEventListener('click', async () => {
      setBusy(b, true);
      try { await fn(); } catch (e) { toast('Error: ' + e.message); } finally { setBusy(b, false); }
    });
  };
  sheetAction('steerBtn', async () => {
    if (!state.turnId) { toast('No hay ningún turno en curso', 'warn'); return; }
    const t = await ask({ title: 'Dirigir turno en curso', message: 'La indicación se aplica al turno que se está ejecutando.', input: 'textarea', okLabel: 'Dirigir' });
    if (!t || !t.trim()) return;
    await rpc('turn/steer', {
      commandId: await newCommandId(), sessionId: state.sessionId,
      expectedTurnId: state.turnId, input: [{ type: 'text', text: t.trim() }],
    });
    closeDialog(sheet);
    toast('Indicación enviada', 'info');
  });
  sheetAction('unqueueBtn', async () => {
    if (!state.queuedTurnId) return;
    await rpc('turn/unqueue', {
      commandId: await newCommandId(), sessionId: state.sessionId, turnId: state.queuedTurnId,
    });
    setQueued(null);
    toast('Turno desencolado', 'info');
  });
  sheetAction('historyBtn', async () => {
    const r = await rpc('view/page', { sessionId: state.sessionId, limit: 200 });
    let n = 0;
    for (const ev of (r && r.events) || []) {
      if (ev && ev.method) { applyViewEvent(ev.method, ev.params || ev); n++; }
    }
    closeDialog(sheet);
    toast('Historial: ' + n + ' eventos cargados', 'info');
  });
  sheetAction('forkBtn', async () => {
    if (!(await ask({ title: '¿Duplicar esta sesión?', message: 'Se crea una copia con toda la historia.', okLabel: 'Duplicar' }))) return;
    const r = await rpc('session/fork', { commandId: await newCommandId(), sessionId: state.sessionId });
    const id = r && ((r.session && r.session.sessionId) || r.sessionId);
    closeDialog(sheet);
    toast('Sesión duplicada', 'info');
    state.sessions = null;
    if (id) await openSession(id, null, r.session, { noHistory: true });
  });
  sheetAction('compactBtn', async () => {
    if (!(await ask({ title: '¿Compactar el contexto?', message: 'Resume la conversación para liberar contexto del modelo.', okLabel: 'Compactar' }))) return;
    const r = await rpc('session/compact', { commandId: await newCommandId(), sessionId: state.sessionId });
    closeDialog(sheet);
    toast('Compactación: ' + ((r && r.status) || 'aceptada'), 'info');
  });
  $('sysBtn').addEventListener('click', () => {
    state.showSys = !state.showSys;
    store('muse-remote-show-sys', state.showSys ? '1' : '0');
    for (const [id, it] of state.items) {
      const li = document.querySelector(`li[data-item="${CSS.escape(id)}"]`);
      if (li && it.kind === 'reminderChild') li.classList.toggle('hidden', !state.showSys);
    }
    updateSysBtn();
  });
  $('shellForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('shellInput');
    const cmd = inp.value.trim();
    if (!cmd) { inp.focus(); return; }
    const b = $('shellBtn');
    setBusy(b, true);
    try {
      await rpc('session/userShell', { commandId: await newCommandId(), sessionId: state.sessionId, commandText: cmd });
      inp.value = '';
      closeDialog(sheet);
      toast('Comando aceptado — el resultado aparece en la conversación', 'info');
    } catch (err) { toast('Error: ' + err.message); }
    finally { setBusy(b, false); }
  });

  // Notificaciones (solo mientras la app sigue viva en segundo plano).
  state.notify = recall('muse-remote-notify') === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  state.pushOn = state.notify && recall('muse-remote-push') === '1';
  syncNotifyBtn();
  $('notifyBtn').addEventListener('click', async () => {
    if (state.notify) {
      state.notify = false;
      state.pushOn = false;
      store('muse-remote-notify', null);
      store('muse-remote-push', null);
      syncNotifyBtn();
      pushUnsubscribe();
      toast('Notificaciones desactivadas', 'info');
      return;
    }
    if (typeof Notification === 'undefined') { toast('Este navegador no soporta notificaciones (en iOS instala la app en la pantalla de inicio)', 'warn'); return; }
    let perm = Notification.permission;
    if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch {} }
    if (perm !== 'granted') { toast('Permiso de notificaciones denegado en el navegador', 'warn'); return; }
    state.notify = true;
    store('muse-remote-notify', '1');
    syncNotifyBtn();
    const b = $('notifyBtn');
    setBusy(b, true);
    try { state.pushOn = await pushSubscribe(true); } catch { state.pushOn = false; }
    finally { setBusy(b, false); syncNotifyBtn(); }
    store('muse-remote-push', state.pushOn ? '1' : null);
    toast(state.pushOn
      ? 'Avisos activados, también con la app cerrada'
      : 'Avisos activados mientras la app siga abierta (push no disponible aquí)', 'info');
  });
  // Abrir la sesion de una notificacion tocada con la app ya abierta.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'open-session' && d.sessionId && state.token && d.sessionId !== state.sessionId) openSession(d.sessionId);
    });
  }
  // Visor de imagenes
  const viewer = $('viewer');
  $('viewerClose').addEventListener('click', () => closeDialog(viewer));
  viewer.addEventListener('click', (e) => { if (e.target !== $('viewerClose')) closeDialog(viewer); });
  viewer.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(viewer); });
  viewer.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
  });

  // Sugerencias del chat vacio: rellenan el composer (no envian).
  for (const b of document.querySelectorAll('#chatEmpty [data-suggest]')) {
    b.addEventListener('click', () => {
      ta.value = b.dataset.suggest;
      autoGrow();
      updateSendState();
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
    });
  }

  // Teclado virtual en iOS: el composer fijo sube con el visualViewport.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const upd = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', kb + 'px');
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
  }

  // Pull-to-refresh en la lista (el nativo esta anulado por overscroll-behavior).
  (() => {
    const ptr = $('ptr');
    let y0 = null;
    let dy = 0;
    const active = () => document.body.dataset.view === 'sessionsView' && !document.querySelector('dialog[open]');
    window.addEventListener('touchstart', (e) => {
      if (!active() || window.scrollY > 0 || e.touches.length !== 1) { y0 = null; return; }
      y0 = e.touches[0].clientY;
      dy = 0;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      dy = Math.min(110, Math.max(0, (e.touches[0].clientY - y0) * 0.5));
      ptr.style.setProperty('--pull', dy + 'px');
      ptr.classList.toggle('ready', dy > 60);
      ptr.classList.toggle('pulling', dy > 4);
    }, { passive: true });
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      ptr.classList.remove('pulling', 'ready');
      ptr.style.setProperty('--pull', '0px');
      if (dy > 60) { vibrate(10); loadSessions(); }
      dy = 0;
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  })();

  // Lista viva: refresco silencioso si el listado es rapido (cache caliente).
  setInterval(() => {
    if (document.body.dataset.view === 'sessionsView' && !document.hidden && state.sessions && (state.lastListMs || 0) < 10000) {
      loadSessions(true);
    }
  }, 30000);

  // Ciclo de vida: al volver a primer plano, revalidar el directo.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.body.dataset.view === 'sessionsView' && state.sessions) loadSessions(true);
    if (document.hidden || !state.sessionId) return;
    if (state.pollMode) { if (state.pollTick) state.pollTick(); return; }
    if (!state.es || Date.now() - (state.lastEventAt || 0) > 30000) connectEvents();
  });
  window.addEventListener('offline', () => { setConn(false); setBanner('Sin conexión de red'); });
  window.addEventListener('online', () => {
    setBanner(null);
    if (state.sessionId) setTimeout(() => flushOutbox(false), 800);
    if (state.sessionId && !state.pollMode) connectEvents();
    else if (state.token) setConn(true);
  });

  updateSysBtn();
  updateChips();
  if (state.token) {
    show('sessionsView', { focus: false });
    boot().catch((e) => toast('Error al iniciar: ' + e.message));
  } else showLogin();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});

function showLogin() {
  show('loginView', { focus: false });
  setConn(false);
}
function renderUsage(u) {
  const el = $('usageLine');
  el.innerHTML = '';
  const blocks = [
    [u && u.usage && u.usage.window, 'Ventana'],
    [u && u.usage && u.usage.weekly, 'Semanal'],
  ].filter(([b, l]) => usageLine(b, l));
  if (!blocks.length) { el.textContent = 'sin datos'; return; }
  for (const [b, label] of blocks) {
    const line = usageLine(b, label);
    const used = Number(b.usedPercent) || 0;
    const row = document.createElement('div');
    row.className = 'usage-row';
    const txt = document.createElement('div');
    txt.className = 'usage-txt';
    const [head, ...rest] = line.split(' · ');
    const a = document.createElement('span');
    a.textContent = head;
    const r = document.createElement('span');
    r.textContent = rest.join(' · ');
    txt.append(a, r);
    const m = document.createElement('div');
    m.className = 'meter';
    m.dataset.level = used >= 90 ? 'high' : used >= 70 ? 'mid' : 'low';
    m.setAttribute('role', 'progressbar');
    m.setAttribute('aria-label', label + ' usado');
    m.setAttribute('aria-valuemin', '0');
    m.setAttribute('aria-valuemax', '100');
    m.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, used))));
    const fill = document.createElement('span');
    fill.style.width = Math.max(0, Math.min(100, used)) + '%';
    m.append(fill);
    row.append(txt, m);
    el.append(row);
  }
  el.title = 'Datos del proveedor al momento de la lectura; pueden superar 100%';
}
async function boot() {
  // Badge honesto: solo "en vivo" con backend y host MSP reales.
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    setConn(!!(j.ok && j.mspReady));
    if (!j.mspReady) toast('Backend sin host MSP — espera unos segundos y recarga', 'warn');
  } catch {
    setConn(false);
    toast('Backend no disponible');
  }
  rpc('usage/read', {}).then(renderUsage).catch(() => {
    if (state.token) $('usageLine').textContent = '—';
  });
  const sessions = await loadSessions();
  if (!state.token) return; // token invalido -> ya en login
  // Retomar ultima sesion abierta (persistencia en este dispositivo).
  const last = state.openOnBoot || recall('muse-remote-session');
  state.openOnBoot = null;
  if (last && sessions.some((s) => s.sessionId === last) && !state.sessionId) {
    openSession(last, null, sessions.find((s) => s.sessionId === last));
  }
  // Renovar la suscripcion push (el navegador puede rotarla).
  if (state.pushOn) pushSubscribe(false).then((ok) => { if (!ok) { state.pushOn = false; store('muse-remote-push', null); } }).catch(() => {});
}

// Exportacion solo para tests node (en navegador `module` no existe).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseFrame, sessMeta, fmtDate, fmtRel, isEmptySession, sortSessions, sessTitle, turnos, usageLine, loadHidden, saveHidden, isHidden, CLIENT_MAX_IMAGE_DIM, CLIENT_MAX_IMAGE_BASE64_CHARS, CLIENT_MAX_RPC_BYTES, imageBase64TooLarge, streamEvents, filterSessions, splitFences, parseInline, friendlyError, wsName, parseArgs, toolView, diffStats, looksLikeDiff, fmtElapsed, slashMatches, parseSlash, highlight, extractImages, outboxLoad, outboxAdd, outboxRemove, outboxUpdate, outboxFor, isRetryable, urlB64ToUint8 };
}
