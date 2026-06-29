/* 自杀型 Service Worker v2 - 清缓存 + 注销自己，不刷新页面（防循环） */
/* 旧用户访问后浏览器自动更新此SW → 激活后清缓存+注销 → 用户下次刷新走网络 */

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
      return self.registration.unregister();
    })
  );
});

/* 拦截所有请求 → 永远走网络，不读缓存 */
self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});
