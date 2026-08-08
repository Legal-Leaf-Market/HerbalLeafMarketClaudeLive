/* sw.js — Herbal Leaf Market service worker (RAW static file).
 *
 * IMPORTANT: this fixed your "ReferenceError: self is not defined (line 3, file sw)".
 * That happened because Apps Script served the SW through HtmlService templating,
 * where `self` isn't defined. On Cloudflare it's served as a plain static asset,
 * so `self` (the ServiceWorkerGlobalScope) exists normally. Do NOT template this file.
 */
const CACHE = "hlm-v2";
const PRECACHE = ["/", "/index.html", "/hlm-api.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API calls — always hit the network.
  if (url.pathname.startsWith("/api/") || url.searchParams.has("unsub")) {
    event.respondWith(fetch(req));
    return;
  }

  // Cache-first for static assets, with network fallback + background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && req.method === "GET") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
