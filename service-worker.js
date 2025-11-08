// service-worker.js
const CACHE_NAME = 'trainer-calendar-v1';
const urlsToCache = [
  '/workcalendar/',
  '/workcalendar/index.html',
  '/workcalendar/style.css',
  '/workcalendar/app.js',
  '/workcalendar/manifest.json',
  '/workcalendar/icons/icon-192.png',
  '/workcalendar/icons/icon-512.png'
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // если есть в кэше — вернуть, иначе загрузить из сети
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('activate', (event) => {
  const whitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          if (!whitelist.includes(key)) {
            return caches.delete(key);
          }
        })
      )
    )
  );
});
