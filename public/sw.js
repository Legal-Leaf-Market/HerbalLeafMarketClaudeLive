/* sw.js — Herbal Leaf Market service worker (RAW static file).
 *
 * IMPORTANT: do NOT serve this file through any templating layer. An earlier
 * Apps Script build rendered it via HtmlService, where `self` isn't defined,
 * and it died with "ReferenceError: self is not defined". As a plain static
 * asset `self` (the ServiceWorkerGlobalScope) exists normally.
 */

/* Bump this on any change to the caching strategy. `activate` deletes every
 * cache whose name isn't CACHE, so a bump is what evicts the old one. */
const CACHE = "hlm-v4";

/* Only the API shim is precached. "/" and "/index.html" were in this list and
 * that is what broke: the page HTML got frozen into the cache at install time
 * and, under the old cache-first rule below, was served forever without the
 * worker ever asking the network. Visitors sat on a days-old storefront —
 * stale prices, stale stock — while the deployed site had long since moved on.
 * The page itself must never be precached; it is exactly the thing that changes. */
const PRECACHE = ["/hlm-api.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPageRequest(req, url) {
  return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html") || /\.html?$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  // Never cache the API or cross-origin requests. This site promises live
  // vendor pricing and stock; a cached /api/inventory would make that a lie.
  // /_vercel/ is the analytics beacon (see the va snippet in each page's
  // foot); caching it would count one visit forever, so it passes through
  // untouched too — the same exclusion both sister sites carry.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vercel/") || url.searchParams.has("unsub")) {
    return; // let the browser handle it untouched
  }

  // NETWORK-FIRST for pages. A deploy must be visible on the very next load,
  // not one load later and not never. The cache is only a fallback for offline,
  // which is the sole reason this worker touches HTML at all.
  if (isPageRequest(req, url)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  // Cache-first is still right for the rest — js, css, icons, images. Those are
  // large and change rarely, and a stale one cannot misprice a product. They
  // refresh in the background so the next load picks up any change.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
