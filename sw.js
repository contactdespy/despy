// Despy — Service Worker : notifications push + hors-ligne (robustesse)
// Stratégie : « réseau d'abord » pour l'appli (pour que la mise à jour auto
// fonctionne), repli sur le cache si pas de réseau ; « cache d'abord » pour
// les visuels ; les fonctions Netlify ne sont JAMAIS mises en cache.

var CACHE = 'despy-v1';
var APP_URL = '/despy_app_v23.html';
var CORE = [
  APP_URL,
  '/manifest.json',
  '/assets/logo-despy-nav-h.png?v=3',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) {
      // précache tolérant : un fichier absent ne fait pas échouer l'installation
      return Promise.all(CORE.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);   // purge des anciens caches
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;        // autres domaines : on laisse passer
  if (url.pathname.indexOf('/.netlify/') === 0) return;   // fonctions : jamais de cache

  // L'appli (document) : réseau d'abord, repli cache. Couvre /app, la page
  // et l'appel de mise à jour (fetch no-store) → le réseau gagne quand il y en a.
  var isDoc = req.mode === 'navigate' || url.pathname === APP_URL || url.pathname === '/app';
  if (isDoc) {
    event.respondWith(
      fetch(req).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(APP_URL, copy); });
        return resp;
      }).catch(function () {
        return caches.match(APP_URL);                     // hors-ligne : appli en cache
      })
    );
    return;
  }

  // Visuels et autres ressources same-origin : cache d'abord, sinon réseau
  // (et on met en cache au passage).
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      }).catch(function () { return hit; });
    })
  );
});

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { title: 'Despy', body: event.data ? event.data.text() : 'Nouvelle alerte' }; } catch (_) {}
  }
  var title = data.title || 'Despy — Alerte cybermalveillance';
  var options = {
    body: data.body || 'Une nouvelle arnaque a été détectée en France.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'despy-alert',
    requireInteraction: false,
    data: { url: data.url || 'https://despy.fr' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://despy.fr';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientsArr) {
      for (var i = 0; i < clientsArr.length; i++) {
        if (clientsArr[i].url === url && 'focus' in clientsArr[i]) return clientsArr[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
