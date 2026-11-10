// IFPM phone: keep the app itself available offline, and show notifications sent by the team's sender computer.
// Board data always comes fresh from Dropbox.
const CACHE = 'ifpm-phone-mwawqwnu';
const SHELL = ['./', 'index.html', 'm.css', 'm.js', 'backend.js', 'state.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'ifpm-badge').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;     // Dropbox calls go straight to the network
  // network first, so a new version shows up right away; fall back to the saved copy when offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// ---- notifications ----
// The unread number on the home-screen icon: counted here, cleared when the app is opened.
async function badge(change) {
  const c = await caches.open('ifpm-badge');
  const r = await c.match('n'); let n = r ? +(await r.text()) || 0 : 0;
  n = change === 'clear' ? 0 : n + 1;
  await c.put('n', new Response(String(n)));
  try { if (n) await self.navigator.setAppBadge(n); else await self.navigator.clearAppBadge(); } catch { }
}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'IFPM', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'IFPM', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || undefined, renotify: !!d.tag, timestamp: d.ts || Date.now(), data: { board: d.board || '', item: d.item || '' } }),
    badge('add'),
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = './#open=' + encodeURIComponent((d.board || '') + '|' + (d.item || ''));
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) { const w = wins[0]; try { await w.focus(); } catch { } w.postMessage({ open: d }); return; }
    await self.clients.openWindow(url);
  })());
});
self.addEventListener('message', e => { if (e.data === 'clear-badge') e.waitUntil(badge('clear')); });
