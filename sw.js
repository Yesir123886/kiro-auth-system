/* 自杀型 Service Worker - 唯一任务：清缓存 + 注销自己 + 刷新页面 */
/* 旧用户访问后会自动清除所有旧缓存并注销SW，之后页面不再受SW干扰 */

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    // 1. 清除所有缓存
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) {
        return caches.delete(name);
      }));
    })
    // 2. 接管所有客户端
    .then(function() {
      return self.clients.claim();
    })
    // 3. 注销自己
    .then(function() {
      return self.registration.unregister();
    })
    // 4. 通知所有客户端刷新页面
    .then(function() {
      return self.clients.matchAll({ type: 'window' });
    })
    .then(function(clients) {
      clients.forEach(function(client) {
        client.navigate(client.url);
      });
    })
  );
});
