/* Service worker de Drones : l'app fonctionne hors ligne une fois installée.
   - Le « shell » (page, script, style, Tone.js, icônes) est mis en cache à l'installation.
   - Les samples WAV sont mis en cache la première fois qu'ils sont lus, ou tous d'un coup
     via le bouton « Garder les sons hors ligne » de l'app.
   Changer VERSION force la mise à jour du shell chez les utilisateurs. */

const VERSION = 'drones-2026-11-04-150723';
const SHELL_CACHE = 'drones-shell-' + VERSION;
const SAMPLE_CACHE = 'drones-samples-v1';

const SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './vendor/Tone.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== SAMPLE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/samples/')) {
    // Samples : cache d'abord, sinon réseau puis mise en cache.
    event.respondWith(
      caches.open(SAMPLE_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // En développement local : réseau d'abord, pour voir les modifications sans changer VERSION.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  // Shell : cache d'abord (versionné), sinon réseau.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && SHELL.some(p => url.pathname.endsWith(p.slice(1)))) {
        caches.open(SHELL_CACHE).then(c => c.put(req, res.clone()));
      }
      return res;
    }))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
