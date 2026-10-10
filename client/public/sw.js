// Minimal service worker: enables PWA installability. Deliberately NO caching
// — a trading terminal must never serve a stale bundle or stale data. Pure
// network passthrough; offline shows the browser error honestly.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network passthrough */ });
