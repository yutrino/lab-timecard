// 電波がなくても開けるようにする。キャッシュを先に返し、裏で新しい版に入れ替える。
const CACHE = 'timecard-v5';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'logic.js',
  'effects/director.js', 'effects/particles.js', 'effects/sound.js', 'effects/effects.css', 'effects/finale.js',
  'vendor/pixi.min.mjs', 'vendor/pixi-filters.mjs',
  ...['sfx-riser', 'sfx-push', 'sfx-impact', 'voice-push', 'voice-reach']
    .concat([0, 1, 2, 3, 4].flatMap((t) => [`sfx-fanfare-${t}`, `voice-${t}`]))
    .map((name) => `sounds/${name}.mp3`),
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
