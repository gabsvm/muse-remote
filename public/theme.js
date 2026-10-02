// Aplica el tema guardado antes del primer pintado (evita parpadeo).
// Fichero aparte porque la CSP no permite scripts inline.
try {
  var t = localStorage.getItem('muse-remote-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) { /* almacenamiento no disponible */ }
