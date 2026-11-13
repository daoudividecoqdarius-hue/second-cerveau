const C = 'orga-v2';
const FILES = ['./', 'index.html', 'style.css', 'engine.js', 'gym.js', 'app.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === self.location.origin;     // nos propres fichiers : on revalide toujours (sinon le navigateur peut garder l'ancien style ~10 min)
  e.respondWith(fetch(same ? new Request(e.request, { cache: 'no-cache' }) : e.request).then(r => { const c = r.clone(); caches.open(C).then(x => x.put(e.request, c)).catch(() => {}); return r; }).catch(() => caches.match(e.request)));
});
/* Notifications envoyées par le serveur, même app fermée */
const API = 'https://second-cerveau-api.second-cerveau-api.workers.dev';
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let list = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch(API + '/api/pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        list = (await r.json()).items || [];
      }
    } catch (_) {}
    if (!list.length) list = [{ title: 'Second Cerveau', body: 'Jette un œil à ton planning.', tag: 'generic' }];
    await Promise.all(list.map(n => self.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: 'icon.svg', data: { url: n.url || '' } })));
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '';          // ex. « #recus » : la notification d'un fichier reçu ouvre la liste de ce qui a été fait
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async l => {
    if (l.length) { const c = l[0]; try { await c.focus(); } catch (_) {} if (url) c.postMessage({ go: url }); return; }
    return self.clients.openWindow('./' + url);
  }));
});
