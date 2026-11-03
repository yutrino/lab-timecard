// 電波がなくても開けるようにする。キャッシュを先に返し、裏で新しい版に入れ替える。
// 映像（media/）と BGM は大きいので最初には入れず、一度使ったものだけが残る。
const CACHE = 'timecard-v10';
const MEDIA_CACHE = 'timecard-media'; // 版を上げても消さない
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'logic.js',
  'effects/director.js', 'effects/particles.js', 'effects/sound.js', 'effects/effects.css', 'effects/gl.js', 'effects/patterns.js',
  'vendor/pixi.min.mjs', 'vendor/pixi-filters.mjs',
  ...['sfx-riser', 'sfx-push', 'sfx-impact', 'sfx-stop', 'sfx-tick', 'sfx-cutin', 'sfx-upgrade', 'sfx-heartbeat', 'sfx-respin', 'sfx-start', 'sfx-drumroll',
    'voice-push', 'voice-reach', 'voice-start', 'voice-chance', 'voice-weekly',
    'voice-rush', 'voice-zenkaiten', 'voice-kakutei', 'voice-kita', 'voice-stepup', 'voice-round']
    .concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `voice-m${i}`))
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  const media = /\/(media\/|sounds\/bgm-)/.test(url.pathname);
  event.respondWith(
    caches.open(media ? MEDIA_CACHE : CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (media && cached) return cached; // 素材は変わらないので取り直さない
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
