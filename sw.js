// CT Investments — Service Worker
const CACHE_NAME = 'ct-invest-v60';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/chart-extended.js',
  '/js/ai-scoring.js',
  '/js/app-charts.js',
  '/js/app-overview.js',
  '/js/app-stock.js',
  '/js/app-market.js',
  '/js/app-member.js',
  '/js/app-tools.js',
  '/js/app-compare.js',
  '/js/app-trade.js',
  '/js/app-extra.js',
  '/js/app-academy.js',
  '/manifest.json',
  'https://unpkg.com/lightweight-charts@4/dist/lightweight-charts.standalone.production.js'
];

// Install: cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls & proxy: network only (stock data must be fresh)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // Static assets: network first, fallback to cache (ensures updates are seen immediately)
  e.respondWith(
    fetch(e.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => caches.match(e.request))
  );
});

// Notification click — open app and navigate to stock
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = data.code ? '/?stock=' + data.code : '/';
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
