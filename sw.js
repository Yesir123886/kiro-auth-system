const CACHE_NAME = 'angel-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/assets/logo.png',
  '/assets/tg-qrcode.png',
  '/manifest.json'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache).catch(function(){});
    })
  );
});

// 网络优先（HTML页面），缓存仅作离线兜底
self.addEventListener('fetch', function(e) {
  var req = e.request;
  // HTML导航请求：永远先走网络，拿到最新版
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(function(resp) {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
        return resp;
      }).catch(function() {
        return caches.match(req);
      })
    );
    return;
  }
  // 其他资源：缓存优先，回退网络
  e.respondWith(
    caches.match(req).then(function(resp) {
      return resp || fetch(req);
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keyList) {
      return Promise.all(keyList.map(function(key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});
