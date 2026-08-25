/*
 * Xenon service worker — Phase 0.
 *
 * Deliberately does NOTHING but exist and pass fetches through. A fetch
 * handler is what makes the app installable to a home screen; caching and the
 * offline attendance-sync engine belong to the Attendance tag and must NOT be
 * added here yet. Caching now would serve stale payment/attendance screens.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass through to the network. No respondWith() => default browser handling.
});
