/*
 * Xenon service worker — Attendance Tag B.
 *
 * Scope is deliberately narrow. Only /attendance is meant to survive a router
 * outage; registration, payments and reports must fail visibly rather than
 * serve yesterday's numbers, so nothing of theirs is ever served from cache.
 *
 * Strategy:
 *   navigations      network-first. A successful /attendance load is cached so
 *                    the shell can come back offline; every other route falls
 *                    back to /offline, never to a stale copy of itself.
 *   /_next/static/*  cache-first. Hashed filenames, so a hit is always correct.
 *   everything else  network only.
 *
 * Never cached: any non-GET (server actions are POST), /api/*, and RSC payload
 * requests. Marks travel through the outbox in IndexedDB, not through here.
 */

const VERSION = "xenon-v4-attendance-offline";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;

/** Reachable with no session, so it can be precached before anyone signs in. */
const OFFLINE_URL = "/offline";
const ATTENDANCE_URL = "/attendance";

/** Used only if even the precached /offline page is missing. */
const FALLBACK_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>No connection</title>
<style>body{font:14px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;
background:#fbfafc;color:#2a2431;text-align:center;padding:24px}
a{display:inline-block;margin-top:16px;background:#7c3aed;color:#fff;padding:9px 16px;
border-radius:6px;text-decoration:none}</style>
<div><h1>No connection</h1>
<p>This screen needs the server. Nothing was queued, so nothing is lost.</p>
<p>Attendance still works offline on this device.</p>
<a href="/attendance">Go to Attendance</a></div>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE_URL, "/manifest.webmanifest"]))
      // A missing asset must not wedge the whole worker in "installing".
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Re-assert the offline page on every activation: if the install-time
    // precache failed (no session yet, a flaky first load), the fallback would
    // otherwise be missing for the life of the worker.
    caches
      .open(SHELL)
      .then((c) => c.add(OFFLINE_URL))
      .catch(() => {})
      .then(() => caches.keys())
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Serve a cached page as a BRAND NEW response.
 *
 * Handing `caches.match()`'s response straight to a navigation does not work
 * reliably: a cached entry carries the redirect and body state of the response
 * that was stored, and Chrome rejects some of those for a navigation request —
 * which shows the browser's own error page instead of ours, intermittently and
 * only for some routes. Reading the body out and rebuilding a plain 200 avoids
 * the whole class of problem.
 */
async function replay(path, isShell) {
  try {
    const hit = await caches.match(path);
    if (hit) {
      const html = await hit.text();
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  } catch {
    // Fall through to the built-in page.
  }
  return new Response(FALLBACK_HTML, {
    status: isShell ? 503 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const isStaticAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // POSTs (server actions, Auth.js) and cross-origin traffic pass straight
  // through. Caching a mutation would be a correctness bug, not an optimisation.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only the attendance shell is worth keeping. Note this caches an
          // authenticated page: acceptable on a dedicated counter terminal,
          // and it is replaced on every successful visit.
          if (res.ok && url.pathname === ATTENDANCE_URL) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(ATTENDANCE_URL, copy));
          }
          return res;
        })
        .catch(async () => {
          const wanted = url.pathname === ATTENDANCE_URL ? ATTENDANCE_URL : OFFLINE_URL;
          return replay(wanted, url.pathname === ATTENDANCE_URL);
        }),
    );
  }
});
