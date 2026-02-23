const CACHE = 'lokal-v1'
self.addEventListener('install', e => { self.skipWaiting() })
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/stream/')) return
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok && e.request.method === 'GET' && !e.request.url.includes('/api/')) {
      caches.open(CACHE).then(c => c.put(e.request, res.clone()))
    }
    return res
  }).catch(() => caches.match('/'))))
})
