// sw.js
const CACHE_NAME = 'radiology-planner-cache-v2'; // Updated version
const urlsToCache = [
  '/',
  '/index.html',
  '/index.css',
  '/reset.css',
  '/manifest.json',
  '/favicon.ico',
  '/logo192.png',
  '/logo512.png',
];

// Install event: open cache and add core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Force activation of new service worker
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of all open clients
  );
});

// Fetch event: Serve cached content or fetch from network with robust fallbacks
self.addEventListener('fetch', event => {
  // For navigation requests (e.g., loading the app), use a "Network Falling Back to Cache" strategy.
  // This ensures the user gets the latest version if online, but the app still loads offline or if there's a routing error.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // If the network returns a valid response, use it and cache it.
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return response;
          }
          // If the network returns a 404 or other error, it's likely an SPA routing issue.
          // Serve the cached index.html as a fallback.
          console.warn(`Service Worker: Network response not OK for navigation (${response.status}). Falling back to cache.`);
          return caches.match('/index.html');
        })
        .catch(error => {
          // If the network request itself fails (e.g., offline), serve from cache.
          console.log('Service Worker: Network fetch failed for navigation. Falling back to cache.', error);
          return caches.match('/index.html');
        })
    );
    return; // End here for navigation requests.
  }

  // For all other requests (CSS, JS, images, etc.), use a "Cache First, then Network" strategy.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        // Check if we received a valid response before caching
        if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
        }
        return networkResponse;
      });
    })
  );
});