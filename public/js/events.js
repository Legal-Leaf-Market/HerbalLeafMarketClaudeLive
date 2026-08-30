/* ============================================================
   /js/events.js — first-party analytics, in the browser.
   ------------------------------------------------------------
   PORTED FROM Kawaii Katz's lib/site-events.ts, written as a
   plain script because the front end of this site is static HTML
   in public/ with no build step. Only the API layer is Next.

   ------------------------------------------------------------
   IT REVIVES hlmTrack() RATHER THAN REPLACING IT
   ------------------------------------------------------------
   THE THING WORTH KNOWING ABOUT THIS SITE: analytics have been
   dead since the migration off Google Apps Script, silently and
   completely. `hlmTrack()` in app.js opens with

       if (typeof google === "undefined" || !google.script ||
           !google.script.run) return;

   which is false on Vercel, so every one of its call sites has
   been a no-op and the `clicks` table has had nothing writing to
   it. `public/admin.html` fails the same way for the same
   reason. An empty analytics table looks exactly like a site
   nobody visits, which is why this went unnoticed.

   So this file REDEFINES window.hlmTrack after app.js loads.
   Every existing call site in app.js starts working again with
   no edit to app.js at all: the sister-shop banner, the sister
   card, the ritual cross-sell and trackVendorCheckout() all
   route into the new sink. Their payload shape (type, vendor,
   product, category, page, device) maps onto the event columns.

   The rest is delegated listeners on `document`, so nothing else
   in app.js is touched either.

   ------------------------------------------------------------
   THE PRIVACY CEILING
   ------------------------------------------------------------
   `sid` is a random value in sessionStorage. It dies with the
   tab, never leaves this origin, and cannot follow a person
   between visits or across devices. No IP, no cookie, no
   fingerprint. It exists so a funnel can tell one visit's steps
   from another's and for nothing else.

   NOTE the old payload carried `email` for signed-in members.
   This one deliberately does not: an email in an analytics row
   turns a shape-of-visit table into a log of what a named person
   looked at, which is a different thing to hold and a different
   thing to lose.
   ============================================================ */

(function () {
  'use strict';

  var ENDPOINT = '/api/events';
  var SID_KEY = 'hlm_sid';
  var FLUSH_MS = 2500;
  var MAX_QUEUE = 20;

  function sid() {
    try {
      var v = sessionStorage.getItem(SID_KEY);
      if (!v) {
        v = (self.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
          .replace(/-/g, '').slice(0, 24);
        sessionStorage.setItem(SID_KEY, v);
      }
      return v;
    } catch (e) {
      /* Private mode or blocked storage. A per-call id still records the
         event; it just cannot be joined into a funnel, which is the right
         way for this to degrade. */
      return 'nostore';
    }
  }

  /* Batched. sendBeacon on hide, because outbound_click fires as the page
     is going away and a fetch() there is routinely cancelled mid-flight. */
  var queue = [], timer = null;

  function flush() {
    if (!queue.length) return;
    var batch = queue; queue = [];
    if (timer) { clearTimeout(timer); timer = null; }
    var body = JSON.stringify({ events: batch });
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall through */ }
    try {
      fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: body, keepalive: true
      })['catch'](function () {});
    } catch (e) { /* analytics must never break the page */ }
  }

  function track(name, props) {
    try {
      props = props || {};
      queue.push({
        name: name,
        sid: sid(),
        path: props.path || (location.pathname + (location.search || '')).slice(0, 200),
        productId: props.productId,
        vendor: props.vendor,
        cat: props.cat,
        meta: props.meta
      });
      if (queue.length >= MAX_QUEUE) return flush();
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    } catch (e) { /* analytics must never break the page */ }
  }
  window.hlmEvent = track;

  /* ------------------------------------------------- the hlmTrack shim */

  /* app.js's own vocabulary, mapped onto ours. Anything not listed lands as
     outbound_click, which is what `type` defaulted to in the original. */
  var TYPE_MAP = {
    'checkout': 'checkout_click',
    'sister-banner': 'sister_click',
    'sister-card': 'sister_click',
    'sister-ritual': 'sister_click',
    'outbound': 'outbound_click'
  };

  function shim() {
    var prev = window.hlmTrack;
    window.hlmTrack = function (type, extra) {
      try {
        extra = extra || {};
        track(TYPE_MAP[type] || 'outbound_click', {
          productId: extra.product,
          vendor: extra.vendor,
          cat: extra.category,
          /* Keep the original type when it was remapped, so the dashboard's
             "every event" panel can still tell a sister-card click from a
             sister-banner one without a column per flavour. */
          meta: TYPE_MAP[type] ? type : (extra.meta || type)
        });
      } catch (e) { /* never break a checkout */ }
      /* If the Apps Script path ever exists again, let it run too. */
      try { if (typeof prev === 'function') prev(type, extra); } catch (e) {}
    };
  }

  /* ------------------------------------------------------- the wiring */

  function sameOrigin(href) {
    try { return new URL(href, location.href).host === location.host; } catch (e) { return true; }
  }

  function boot() {
    shim();
    track('page_view');

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      var a = t.closest('a[href]');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (/^https?:/i.test(href) && !sameOrigin(href)) {
          /* THE MONEY EVENT. Everything else on this page is context for it.
             Read from the DOM rather than from app.js state so a renderer
             change cannot silently stop this firing. */
          var card = a.closest('[data-vendor], .card, .prod-card');
          track('outbound_click', {
            vendor: (card && card.getAttribute('data-vendor')) || undefined,
            productId: href.split('?')[0].split('#')[0].slice(0, 200),
            meta: 'link'
          });
          flush();
        }
        return;
      }

      /* Buttons that leave via JavaScript rather than an anchor. app.js calls
         hlmTrack('checkout') itself, which the shim now catches, so this only
         covers the cart being opened. */
      if (t.closest('[onclick*="openCart"], .cart-btn, #cartBtn')) track('cart_open');
    }, true);

    /* Flush on hide. visibilitychange rather than unload, which does not fire
       reliably on mobile Safari. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  /* AFTER app.js, so the shim wraps the real function rather than being
     overwritten by it. The script tag is placed after app.js for the same
     reason; this is the belt to that braces. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
