// Despy — Service Worker pour notifications push nationales
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { title: 'Despy', body: event.data ? event.data.text() : 'Nouvelle alerte' }; } catch (_) {}
  }
  var title = data.title || 'Despy — Alerte cybermalveillance';
  var options = {
    body: data.body || 'Une nouvelle arnaque a été détectée en France.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'despy-alert',
    requireInteraction: false,
    data: { url: data.url || 'https://despy.fr' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://despy.fr';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientsArr) {
      for (var i = 0; i < clientsArr.length; i++) {
        if (clientsArr[i].url === url && 'focus' in clientsArr[i]) return clientsArr[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
