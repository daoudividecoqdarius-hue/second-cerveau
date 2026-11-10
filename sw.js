const C = 'orga-v2';
const FILES = ['./', 'index.html', 'style.css', 'engine.js', 'app.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(C).then(x => x.put(e.request, c)).catch(() => {}); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : self.clients.openWindow('./')));
});
