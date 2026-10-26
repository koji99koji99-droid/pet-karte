const CACHE_PREFIX = 'pet-karte-shell-';
const CACHE = `${CACHE_PREFIX}1.1.0`;
const SHELL = ['./', './index.html', './view.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './js/app.js', './js/view.js', './js/share.js', './js/db.js', './js/ocr.js', './js/karte.js', './js/chart.js', './js/backup.js'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const oldCaches = await caches.keys();
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      const response = await fetch(path, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`アプリの取得に失敗しました: ${path}`);
      await cache.put(path, response);
    }));
    // 旧版の画面には更新ボタンがないため、初回移行だけ再読み込みせず有効化する。
    if (oldCaches.includes('pet-karte-shell-v4')) await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone()).catch(() => {});
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
