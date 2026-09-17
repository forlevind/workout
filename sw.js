// Минимальный service worker: сеть приоритетнее, кэш — подстраховка для офлайна (зал без связи).
// Данные приложения лежат в localStorage, поэтому офлайн-режим полностью рабочий.
const CACHE = 'workout-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/logic.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // чужие запросы не трогаем

  event.respondWith(
    fetch(request)
      .then((response) => {
        // свежий ответ обновляет кэш: правки в файлах видны сразу при наличии сети
        const copy = response.clone();
        caches
          .open(CACHE)
          .then((cache) => cache.put(request, copy))
          .catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
