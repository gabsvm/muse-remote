// Service worker: app-shell offline para la PWA. Nunca cachea /api/*.
// Red primero (con revalidacion no-cache del servidor) y cache como respaldo
// offline: antes era cache-first y la PWA podia quedarse con un app.js viejo
// hasta que se cambiaba la version del SW.
const CACHE = 'muse-remote-v26';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/global-search.js', '/organizer-crypto.js', '/organizer-ui.js', '/theme.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/muse-remote-wordmark.png', '/apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // siempre red
  const isNav = req.mode === 'navigate';
  // Navegaciones (incl. ?text= del share target) se guardan como "/".
  const key = isNav ? '/' : req;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || (isNav ? caches.match('/index.html') : Response.error())))
  );
});

// Web Push del backend: aviso aunque la PWA este cerrada. Si la app esta
// visible y enfocada, su propia UI ya lo muestra y no se duplica.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      if (d.tag !== 'test' && cs.some((c) => c.visibilityState === 'visible' && c.focused)) return undefined;
      return self.registration.showNotification(d.title || 'Muse Remote', {
        body: d.body || '', tag: d.tag || 'muse', renotify: true,
        icon: '/icon-192.png', badge: '/icon-192.png', data: { sessionId: d.sessionId || null },
      });
    })
  );
});
// Tocar una notificacion enfoca la PWA (y abre su sesion) o la abre.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const sid = (e.notification.data && e.notification.data.sessionId) || null;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) {
          if (sid) c.postMessage({ type: 'open-session', sessionId: sid });
          return c.focus();
        }
      }
      return self.clients.openWindow('/' + (sid ? '?session=' + encodeURIComponent(sid) : ''));
    })
  );
});
