const VERSION = 'ustc-schedule-v2';
const SHELL = ['/', '/styles.css', '/app.js', '/dates.js', '/school.js', '/ical-import.js', '/vendor/ical.js',
  '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/import-help.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('ustc-schedule-') && key !== VERSION)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(request).then(async (response) => {
    if (response.ok && !url.search) {
      const cache = await caches.open(VERSION);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(async () => (await caches.match(url.pathname)) || Response.error()));
});
self.addEventListener('push', (event) => {
  let details;
  try { details = event.data?.json(); } catch { details = null; }
  event.waitUntil(self.registration.showNotification(details?.title || '科大日程', {
    body: details?.body || '你有一条提醒。', icon: '/icon-192.png', tag: details?.tag, data: { url: details?.url || '/' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients[0];
    if (!client) return self.clients.openWindow(url.href);
    await client.navigate(url.href);
    return client.focus();
  }));
});
