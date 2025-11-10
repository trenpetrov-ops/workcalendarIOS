// service-worker.js
const CACHE_VERSION = 'v6'; // ⬅️ увеличивай при каждом деплое
const CACHE_NAME = `trainer-calendar-${CACHE_VERSION}`;

const urlsToCache = [
  '/workcalendar/',
  '/workcalendar/index.html',
  '/workcalendar/style.css?v=20251109',
  '/workcalendar/app.js?v=20251109',
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


// ---------- Установка ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting(); // ⚡ сразу активировать новую версию
});

// ---------- Активация ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('trainer-calendar-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // ⚡ новая версия сразу подхватывается
});

// ---------- Обработка запросов ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // ⚠️ Игнорируем не-GET запросы
  if (request.method !== 'GET') return;

  // ⚠️ Игнорируем Firestore / Firebase / Google API / аналитики
  const url = request.url;
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('gstatic.com/firebasejs') ||
    url.includes('identitytoolkit.googleapis.com')
  ) {
    return;
  }

  // ⚙️ Сеть → кэш → оффлайн fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // ✅ успешный ответ — кладём в кэш
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return networkResponse;
      })
      .catch(async () => {
        // 📴 оффлайн: пробуем кэш
        const cached = await caches.match(request);
        if (cached) return cached;

        // 🧩 если ничего нет — пробуем отдать index.html (для SPA)
        if (request.mode === 'navigate') {
          return caches.match('/workcalendar/index.html');
        }
      })
  );


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
