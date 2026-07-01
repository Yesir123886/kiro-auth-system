/* 自杀型 Service Worker v3 - 强制清缓存 + 注销自己 */
/* 升级版本号触发SW更新 → 清所有缓存 → 注销 → 下次刷新走纯网络 */

var CACHE_VERSION='v3-force-clean';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) {
        return caches.delete(name);
      }));
    })
    .then(function() {
      return self.clients.claim();
    })
    .then(function() {
      // 通知所有客户端刷新
      return self.clients.matchAll({type:'window'}).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({type:'FORCE_RELOAD'});
        });
      });
    })
    .then(function() {
      return self.registration.unregister();
    })
  );
});

/* 拦截所有请求 → 永远走网络（no-store），不读缓存 */
self.addEventListener('fetch', function(event) {
  var req=new Request(event.request.url, {cache:'no-store'});
  event.respondWith(fetch(req));
});
