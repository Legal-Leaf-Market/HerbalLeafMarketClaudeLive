/* ============================================================================
   analytics.js  ·  one tracking layer, four storefronts
   ----------------------------------------------------------------------------
   This file is IDENTICAL on legal-leafmarket, nicotia-market, herbal-leaf and
   kawaiikatz. Everything site-specific arrives as a data-attribute on the
   script tag, so a fix made here can be copied byte-for-byte to the other
   three. Do not fork it per site. If you need per-site behaviour, add a
   data-attribute.

       <script src="/js/analytics.js" defer data-site="legal-leaf"></script>

   The GA4 measurement id is NOT on the tag. It lives in the GA_ID constant a
   few lines below, because it is on roughly fifty pages across the four repos
   and threading it through every tag would make changing it a fifty-file edit.
   One constant, four copies of this file.

   ----------------------------------------------------------------------------
   WHY THIS EXISTS AT ALL (read before you replace it with Vercel's tracker)

   Vercel Web Analytics cannot carry this workload, and the numbers are on
   their own pricing page (vercel.com/docs/analytics/limits-and-pricing):

     - Custom events are Pro-only. On Hobby the row is a dash, not a quota.
       Every va("event", ...) call these sites used to make was being dropped
       on the floor. Page views were the only thing surviving.
     - Even on Pro a custom event carries 2 properties. Two. An
       affiliate_click needs store, product, price, position and path to be
       worth anything.
     - The Hobby reporting window is 1 month, so Legal-Leaf's traffic history
       rolls off before it can show a seasonal trend.
     - UTM parameters need Pro plus the $10/mo Web Analytics Plus add-on,
       which means paid-channel attribution is impossible on the free tier.

   So Vercel stays exactly where it is good: free, automatic, cookieless page
   views. It is the traffic baseline. This file owns everything else.

   ----------------------------------------------------------------------------
   THE THREE SINKS

     1. GA4 via gtag        the reporting brain. 10M events/mo free, 25 params
                            per event, 14-month retention, funnels, free
                            BigQuery export. Only loads if data-ga is set, so
                            this file is inert and harmless until then.

     2. First-party POST    /api/track on the site's own domain. This is the
                            ad-block story: roughly a quarter of a cannabis or
                            nicotine audience runs a blocker, and every one of
                            them kills googletagmanager.com while leaving a
                            same-origin fetch to our own API alone. The
                            collector re-sends those events to GA4 server-side
                            over the Measurement Protocol, so the blocked
                            quarter still lands in the same reports.

     3. Vercel va()         OFF by default, see SINK 3 below for the reason.

   A single track() call fans out to whichever sinks are configured. Adding or
   removing a sink never touches a call site.
   ========================================================================= */
(function () {
  "use strict";

  /* ---- config ------------------------------------------------------------

     GA_ID: paste the measurement id here once, then copy this file to the
     other three repos. Empty is a valid, shipping state: with no id the GA4
     sink never loads, no third-party request is made, no cookie is set, and
     the first-party collector keeps working on its own.

     ONE property for all four sites, not four. The hostname dimension already
     separates them in every report, so nothing is lost, and it buys two things
     four properties cannot: one dashboard to open instead of four, and
     visibility of the shopper who crosses from Nicotia to Legal-Leaf through
     the sister-site links in the footers. Those journeys are invisible if each
     site is its own property, and they are the whole argument for running the
     family as a family. */

  var GA_ID = "";

  var TAG = document.currentScript;
  function attr(n, d) { var v = TAG && TAG.getAttribute(n); return v == null || v === "" ? d : v; }

  /* The site key is resolved from the hostname and only overridden by
     data-site. Deriving it means the tag still reports correctly if the
     attribute is dropped, which is not hypothetical: next/script rebuilds the
     element rather than emitting the JSX verbatim, and a page copied from one
     repo to another arrives with the wrong key. The hostname cannot be wrong. */
  var SITE_BY_HOST = {
    "legal-leafmarket.com": "legal-leaf",
    "nicotiamarket.com":    "nicotia",
    "herballeafmarket.com": "herbal-leaf",
    "kawaiikatz.com":       "kawaiikatz"
  };
  function hostKey() {
    var h = location.hostname.replace(/^www\./, "");
    return SITE_BY_HOST[h] || h;
  }

  var CFG = {
    site:     SITE_BY_HOST[location.hostname.replace(/^www\./, "")] || attr("data-site", hostKey()),
    ga:       attr("data-ga", GA_ID),
    endpoint: attr("data-endpoint", "/api/track"),
    /* Fan the money events to Vercel too. Off unless the team is on Pro:
       see the header. Even then only 2 props per event survive, so we send
       the two that matter and drop the rest rather than let Vercel choose. */
    vercel:   attr("data-vercel", "0") === "1",
    debug:    /[?&]debug_analytics\b/.test(location.search)
  };

  /* Hosts that are ours, not a vendor. An outbound click to one of these is
     internal navigation across the family and must never be counted as an
     affiliate handoff, or cross-links between the sister sites would look
     like revenue events. */
  var FAMILY = /(^|\.)(legal-leafmarket|nicotiamarket|herballeafmarket|kawaiikatz)\.com$/i;
  var SOCIAL = /(^|\.)(facebook|instagram|x|twitter|reddit|youtube|tiktok|pinterest|linkedin)\.com$/i;

  /* ---- identity ----------------------------------------------------------
     Cookieless. A random id in localStorage, no PII, nothing derived from the
     device, so it cannot be joined to anything off-site. The session window is
     30 minutes of inactivity, chosen to match GA4's own definition: if the two
     disagree about where a session ends, the first-party numbers and the GA4
     numbers stop reconciling and you can never tell which one is lying. */

  var IDLE = 30 * 60 * 1000;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function rand() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); }

  var VID = store("sa_vid") || (function () { var v = rand(); store("sa_vid", v); return v; })();

  var SES = (function () {
    var now = Date.now(), raw = store("sa_ses"), s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    if (!s || !s.id || now - (s.last || 0) > IDLE) {
      s = { id: rand(), start: now, last: now, n: 1, isNew: true };
    } else {
      s.last = now; s.n = (s.n || 0) + 1; s.isNew = false;
    }
    store("sa_ses", JSON.stringify({ id: s.id, start: s.start, last: s.last, n: s.n }));
    return s;
  })();

  function touchSession() {
    SES.last = Date.now();
    store("sa_ses", JSON.stringify({ id: SES.id, start: SES.start, last: SES.last, n: SES.n }));
  }

  /* ---- acquisition -------------------------------------------------------
     Captured once, on the first event of a session, and then carried on every
     later event in that session. Attribution has to survive the click that
     leaves the landing page, otherwise every conversion is credited to
     "direct" and the paid channels look worthless. */

  var ACQ = (function () {
    var q = new URLSearchParams(location.search), out = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
      if (q.get(k)) out[k] = q.get(k).slice(0, 100);
    });
    if (q.get("gclid")) out.click_id = "google";
    if (q.get("fbclid")) out.click_id = "meta";
    if (q.get("ref")) out.ref_code = q.get("ref").slice(0, 60);

    var r = document.referrer || "";
    var rh = "";
    try { rh = r ? new URL(r).hostname.replace(/^www\./, "") : ""; } catch (e) {}
    if (rh && rh !== location.hostname.replace(/^www\./, "")) out.referrer_host = rh;

    var prev = {};
    try { prev = JSON.parse(store("sa_acq") || "{}"); } catch (e) {}

    /* A campaign arriving mid-session starts a new session, which is what GA4
       does and what makes paid attribution honest. Without this, a shopper who
       browses, leaves, clicks an ad and comes back inside the 30-minute window
       has the whole visit credited to however they found the site the first
       time, and the ad that actually brought them back earns nothing. */
    var campaignChanged = !!out.utm_source && out.utm_source !== prev.utm_source;
    if (campaignChanged && !SES.isNew) {
      SES = { id: rand(), start: Date.now(), last: Date.now(), n: 1, isNew: true };
      store("sa_ses", JSON.stringify({ id: SES.id, start: SES.start, last: SES.last, n: SES.n }));
    }

    /* Only the first page of a session is a landing page. On later pages the
       stored value wins, which is what makes attribution stick across the
       click off the landing page. */
    if (SES.isNew) {
      out.landing_path = location.pathname;
      store("sa_acq", JSON.stringify(out));
      return out;
    }
    return prev;
  })();

  /* ---- device context ---------------------------------------------------- */

  var CTX = {
    device: (function () {
      var w = window.innerWidth;
      return w < 768 ? "mobile" : w < 1200 ? "tablet" : "desktop";
    })(),
    /* Standalone means the visitor added the site to their home screen. These
       sites cannot be in either app store (controlled substances), so the PWA
       is the retention channel and its share of sessions is a real KPI. */
    pwa: (function () {
      try { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { return false; }
    })()
  };

  /* ============================================================================
     SINK 1 · GA4
     Loaded lazily and only when a measurement id is configured, so a site with
     data-ga="" pays nothing: no third-party request, no cookie, no consent
     obligation. That is deliberate. It lets this whole layer ship and start
     collecting first-party data before the GA4 property exists.
     ========================================================================= */

  /* Tri-state, and it is the hinge of the whole ad-block story.
       null  = no measurement id configured, GA4 is not part of this deploy
       true  = gtag.js loaded and has already reported these events itself
       false = gtag.js was blocked or failed, so the collector must re-send
               them to GA4 server-side over the Measurement Protocol
     Without this flag the recovery path would double-count every event from
     every visitor who is NOT running a blocker, which is most of them. */
  var GA_OK = null;

  var ga = (function () {
    if (!CFG.ga) return function () {};
    GA_OK = false;

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;

    /* These sites run no advertising and no remarketing, so denying ad storage
       up front is free. It shrinks the cookie surface to analytics_storage
       alone, which is the difference between needing a full consent banner and
       needing a line in the privacy policy in most of the US. */
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"
    });

    gtag("js", new Date());
    /* send_page_view is off because this file owns page_view, including the
       history-API navigations GA4's own auto-pageview misses on the Next.js
       sites. Two sources of page_view means every session doubles. */
    gtag("config", CFG.ga, { send_page_view: false, transport_type: "beacon" });

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(CFG.ga);
    s.onload = function () { GA_OK = true; };
    s.onerror = function () { GA_OK = false; };
    document.head.appendChild(s);

    /* Belt and braces. Some blockers answer the request with an empty 200
       rather than failing it, so onload fires but no tag manager ever appears.
       Checking for the real object a few seconds later catches that case. */
    setTimeout(function () { if (!window.google_tag_manager) GA_OK = false; }, 4000);

    return function (name, props) { try { gtag("event", name, props); } catch (e) {} };
  })();

  /* gtag's own client id, so events recovered server-side attach to the same
     GA4 user instead of inventing a second one. Only present once gtag has
     run; when it is missing the collector falls back to our visitor id, which
     is the right answer anyway because a blocked visitor has no GA4 identity
     to reconcile with. */
  function gaClientId() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)_ga=GA\d\.\d\.(\d+\.\d+)/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  /* GA4 fires its own reports off reserved event names. Sending view_item
     rather than product_view is what makes the Monetization section populate
     instead of sitting empty next to a pile of custom events nobody charted.
     Anything not in this map keeps its own name and lands in Explorations. */
  var GA_NAME = {
    product_view:     "view_item",
    add_to_cart:      "add_to_cart",
    remove_from_cart: "remove_from_cart",
    view_cart:        "view_cart",
    begin_checkout:   "begin_checkout",
    newsletter_signup:"sign_up",
    search:           "search",
    outbound_click:   "click"
  };

  function toGa4(name, p) {
    var out = {}, k;
    for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
    if (name === "search" && p.query) { out.search_term = p.query; delete out.query; }

    /* The ecommerce events want an items[] array or the reports stay blank. */
    if (/^(product_view|add_to_cart|remove_from_cart|begin_checkout)$/.test(name) && p.product) {
      out.currency = p.currency || "USD";
      out.value = Number(p.price || 0) || 0;
      out.items = [{
        item_id: String(p.product).slice(0, 100),
        item_name: String(p.product).slice(0, 100),
        item_brand: p.store || undefined,
        item_category: p.category || undefined,
        price: Number(p.price || 0) || 0,
        quantity: Number(p.qty || 1) || 1
      }];
    }
    return out;
  }

  /* ============================================================================
     SINK 2 · first-party collector
     Batched, because one request per event on a grid where a shopper opens
     fifteen cards is fifteen function invocations. Flushed on a timer, on a
     full buffer, and unconditionally on pagehide, where sendBeacon is the only
     transport the browser guarantees to finish after the page is gone.
     ========================================================================= */

  var QUEUE = [], TIMER = null;

  function flush(final) {
    if (!QUEUE.length) return;
    var batch = QUEUE.splice(0, QUEUE.length);
    var body = JSON.stringify({
      site: CFG.site,
      vid: VID,
      sid: SES.id,
      ga_ok: GA_OK,            /* see GA_OK above: gates the server-side resend */
      ga_cid: gaClientId(),
      tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ""; } })(),
      events: batch
    });
    clearTimeout(TIMER); TIMER = null;

    try {
      if (final && navigator.sendBeacon) {
        navigator.sendBeacon(CFG.endpoint, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(CFG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
        credentials: "omit"
      })["catch"](function () {});
    } catch (e) {
      /* Analytics must never break a page. A dropped batch is an acceptable
         loss; a thrown exception in a click handler is not. */
    }
  }

  function enqueue(row) {
    QUEUE.push(row);
    if (QUEUE.length >= 12) return flush(false);
    if (!TIMER) TIMER = setTimeout(function () { flush(false); }, 5000);
  }

  /* ============================================================================
     SINK 3 · Vercel
     Off unless data-vercel="1". On Hobby these calls are discarded server-side
     and on Pro they are billed at $0.03/1K and truncated to two properties, so
     sending them by default would be paying for a worse copy of sink 1.
     Vercel's own script still records page views either way; we do not touch
     that, it is the free traffic baseline.
     ========================================================================= */

  var MONEY = /^(affiliate_click|begin_checkout|add_to_cart)$/;

  function toVercel(name, p) {
    if (!CFG.vercel || !MONEY.test(name)) return;
    /* Pick the two props deliberately rather than letting the cap pick for us. */
    try {
      if (typeof window.va === "function") {
        window.va("event", { name: name, store: p.store || "", value: String(p.price || p.cart_value || "") });
      }
    } catch (e) {}
  }

  /* ============================================================================
     track()
     ========================================================================= */

  var LAST = {};

  /* Enough of the payload to tell two genuinely different events apart. A
     signature built from href alone collapsed two different filters changed
     inside the same 400ms, which is a real thing a shopper does with a
     keyboard. Undefined and null both flatten to "" so that a legacy call
     passing store:"" and ours passing nothing still match. */
  var SIG_KEYS = ["href", "product", "path", "query", "filter", "value",
                  "store", "metric", "percent", "seconds", "message"];

  function signature(name, props) {
    var s = name;
    for (var i = 0; i < SIG_KEYS.length; i++) {
      var v = props[SIG_KEYS[i]];
      s += "|" + (v == null ? "" : String(v));
    }
    return s;
  }

  function track(name, props) {
    if (!name) return;
    props = props || {};
    var now = Date.now();

    /* Legal-Leaf's pages still carry their old inline tracker, whose page_view
       and outbound_click handlers cannot be removed without editing the file
       that holds the base64 engine (that repo's CLAUDE.md section 5). Those
       handlers now call straight into this function, so the duplicates are
       collapsed here instead.

       page_view needs a different guard from the time window: the legacy one
       fires on `load` and ours on DOMContentLoaded, and on a heavy catalogue
       page those are comfortably more than 400ms apart. So pageView() is the
       only thing allowed to emit one. It arms the flag immediately before
       calling, and any other caller is dropped, which is correct rather than
       merely convenient: this layer already counts every navigation including
       the history-API ones, so an external page_view is redundant by
       definition. Order-independent, which the counter it replaced was not. */
    if (name === "page_view") {
      if (!PV.armed) return;
      PV.armed = false;
    }

    /* 400ms collapses a genuine double-fire. The money events get 30 seconds,
       for a specific reason: Legal-Leaf's checkout gate holds the click,
       shows the signup modal, and then RE-FIRES the original element with
       t.click() once the shopper is through it. That is one intent to buy
       arriving as two clicks however long the signup took, and counting it
       twice would inflate the only number on this site that stands in for
       revenue. Thirty seconds also absorbs an impatient double-tap while
       still counting a shopper who comes back to the same product later. */
    var sig = signature(name, props);
    var window_ms = /^(affiliate_click|begin_checkout)$/.test(name) ? 30000 : 400;
    if (LAST[sig] && now - LAST[sig] < window_ms) return;
    LAST[sig] = now;

    touchSession();

    var p = {};
    for (var k in ACQ) if (Object.prototype.hasOwnProperty.call(ACQ, k)) p[k] = ACQ[k];
    for (var j in props) if (Object.prototype.hasOwnProperty.call(props, j)) p[j] = props[j];
    p.site = CFG.site;
    p.path = p.path || location.pathname;
    p.device = CTX.device;
    if (CTX.pwa) p.pwa = true;
    p.session_id = SES.id;
    p.visitor_id = VID;

    if (CFG.debug) try { console.log("[analytics]", name, p); } catch (e) {}

    ga(GA_NAME[name] || name, toGa4(name, p));
    toVercel(name, p);
    enqueue({ name: name, ts: now, props: p });

    /* A local ring buffer, kept because Legal-Leaf's admin console reads it and
       because it is the only way to debug a shopper's session from their own
       browser when neither GA4 nor the collector is reachable. */
    try {
      var key = "sa_events", a = JSON.parse(localStorage.getItem(key) || "[]");
      a.push({ t: now, name: name, props: p });
      if (a.length > 250) a = a.slice(-250);
      localStorage.setItem(key, JSON.stringify(a));
    } catch (e) {}
  }

  /* ============================================================================
     AUTO-CAPTURE
     Everything below fires without a call site. The point is that a new page,
     a new product grid or a v0-regenerated component starts reporting the
     moment the tag is on it, with nobody remembering to instrument it.
     ========================================================================= */

  /* armed is the one-shot permit read by the page_view guard in track(). */
  var PV = { path: null, armed: false, t: 0, depth: 0, active: 0, lastTick: 0 };

  function pageView(reason) {
    if (PV.path === location.pathname && reason !== "initial") return;
    if (PV.path !== null) flushEngagement();       /* close out the page we are leaving */

    PV.path = location.pathname;
    PV.t = Date.now(); PV.depth = 0; PV.active = 0; PV.lastTick = Date.now();
    SEEN_DEPTH = {};

    if (SES.isNew && reason === "initial") {
      track("session_start", { entry: location.pathname });
      SES.isNew = false;
    }
    PV.armed = true;
    track("page_view", {
      path: location.pathname,
      title: (document.title || "").slice(0, 120),
      query: location.search ? location.search.slice(1, 200) : undefined,
      nav: reason
    });
  }

  /* ---- SPA navigation ----------------------------------------------------
     KawaiiKatz is a Next.js app router site and Herbal Leaf serves static HTML
     out of a Next project, so one of the four routes client-side and three do
     not. Patching the history API covers both without a framework hook, and
     without this the SPA reports one page view per visit no matter how many
     screens the shopper walks through. */
  ["pushState", "replaceState"].forEach(function (m) {
    var orig = history[m];
    if (typeof orig !== "function") return;
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(function () { pageView("spa"); }, 0);
      return r;
    };
  });
  window.addEventListener("popstate", function () { setTimeout(function () { pageView("back"); }, 0); });

  /* ---- scroll depth ------------------------------------------------------ */

  var SEEN_DEPTH = {};
  var DEPTHS = [25, 50, 75, 90];

  function onScroll() {
    var h = document.documentElement;
    var max = Math.max(h.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
    if (max <= 0) return;
    var pct = Math.round((window.pageYOffset || h.scrollTop) / max * 100);
    if (pct > PV.depth) PV.depth = Math.min(pct, 100);
    for (var i = 0; i < DEPTHS.length; i++) {
      var d = DEPTHS[i];
      if (pct >= d && !SEEN_DEPTH[d]) { SEEN_DEPTH[d] = 1; track("scroll_depth", { percent: d }); }
    }
  }

  /* ---- engagement time ---------------------------------------------------
     Counts only the seconds the tab was visible. Time-on-page measured from
     load to unload counts the forty minutes a tab sat behind another window,
     which makes every "average time on page" figure a fiction. */

  function tick() {
    var now = Date.now();
    if (document.visibilityState === "visible") PV.active += now - PV.lastTick;
    PV.lastTick = now;
  }

  function flushEngagement() {
    tick();
    var secs = Math.round(PV.active / 1000);
    if (secs < 1) return;
    track("engaged_time", { seconds: secs, max_scroll: PV.depth, path: PV.path });
    PV.active = 0;
  }

  /* Everything that must be measured at the very end registers here rather
     than adding its own pagehide listener. Listeners fire in registration
     order, so a late-registered one would enqueue its event AFTER the final
     flush had already emptied the queue and be lost on every single page view.
     One ordered finalizer removes that whole class of bug. */
  var FINAL = [];
  function finalize() {
    for (var i = 0; i < FINAL.length; i++) { try { FINAL[i](); } catch (e) {} }
    flushEngagement();
    flush(true);
  }

  setInterval(tick, 5000);
  document.addEventListener("visibilitychange", function () {
    tick();
    if (document.visibilityState === "hidden") finalize();
  });
  window.addEventListener("pagehide", finalize);

  /* ---- outbound and affiliate clicks -------------------------------------
     The money event. Every one of these four sites earns on the handoff, not
     on a purchase it can see, so the click leaving for a vendor is the closest
     thing to a conversion that exists.

     LISTEN ON window, NOT document, AND DO NOT "TIDY" THIS BACK.

     Legal-Leaf's checkout gate (index.html, the CHECKOUT_SEL block) intercepts
     every checkout click on a DOCUMENT capture listener and calls
     stopImmediatePropagation() to hold the click while it offers the signup
     modal. stopImmediatePropagation kills every other listener on document
     too, including ones registered later, so a document-level analytics
     listener never sees a single checkout click from a logged-out visitor.
     That is the exact bug in the old inline tracker this file replaces: its
     outbound_click handler was on document, below the gate, and has therefore
     never recorded the one event the site exists to produce.

     window is the first node in the capture path, so our handler has already
     run by the time the gate on document gets to stop anything. Every
     delegated listener below is on window for the same reason. */

  window.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href], [data-store], button.checkout, .cocheckout") : null;
    if (!a) return;

    var href = a.getAttribute("href") || a.getAttribute("data-href") || "";
    var host = "";
    try { host = href ? new URL(href, location.href).hostname.replace(/^www\./, "") : ""; } catch (err) {}

    var here = location.hostname.replace(/^www\./, "");
    var isCheckout = a.classList && (a.classList.contains("checkout") || a.classList.contains("cocheckout")) || a.id === "ggDoCheckout";
    var store = a.getAttribute("data-store") || "";

    if (!host || host === here) {
      /* An in-page checkout control with no href is still a handoff. */
      if (isCheckout) track("begin_checkout", { store: store, cart_value: cartValue() });
      return;
    }

    var label = (a.textContent || "").trim().slice(0, 60);
    track("outbound_click", { href: href.slice(0, 300), host: host, text: label });

    if (FAMILY.test(host)) { track("sister_site_click", { host: host }); return; }
    if (SOCIAL.test(host)) return;

    /* Anything left is a vendor. The hostname is the store when the markup
       does not say otherwise, which means a store added to the catalogue
       tomorrow reports correctly today with no config change. */
    track("affiliate_click", {
      store: store || host,
      href: href.slice(0, 300),
      product: a.getAttribute("data-product") || a.getAttribute("data-name") || label,
      price: a.getAttribute("data-price") || undefined,
      position: a.getAttribute("data-pos") || undefined
    });
    if (isCheckout) track("begin_checkout", { store: store || host, cart_value: cartValue() });
  }, true);

  function cartValue() {
    /* Best effort across three different cart shapes. Returns undefined rather
       than 0 when it cannot tell, because a real zero and an unreadable cart
       mean very different things in a report. */
    var keys = ["ll_cart", "nm_cart", "hlm_cart", "kk_cart", "cart"];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]); if (!raw) continue;
        var c = JSON.parse(raw), items = Array.isArray(c) ? c : (c.items || []);
        if (!items.length) continue;
        var sum = 0;
        items.forEach(function (it) { sum += (Number(it.price) || 0) * (Number(it.qty) || 1); });
        return Math.round(sum * 100) / 100;
      } catch (e) {}
    }
    return undefined;
  }

  /* ---- rage clicks -------------------------------------------------------
     Three clicks inside 30px and 700ms. On a catalogue this almost always
     means a card that looks tappable and is not, which is a silent conversion
     leak no funnel report will ever show you. */

  var CLICKS = [];
  window.addEventListener("click", function (e) {
    var now = Date.now();
    CLICKS = CLICKS.filter(function (c) { return now - c.t < 700; });
    CLICKS.push({ t: now, x: e.clientX, y: e.clientY });
    if (CLICKS.length < 3) return;
    var a = CLICKS[0], b = CLICKS[CLICKS.length - 1];
    if (Math.abs(a.x - b.x) < 30 && Math.abs(a.y - b.y) < 30) {
      CLICKS = [];
      var t = e.target;
      track("rage_click", {
        target: (t && (t.id || t.className || t.tagName) || "").toString().slice(0, 80)
      });
    }
  }, true);

  /* ---- search, filters, forms -------------------------------------------- */

  var searchTimer = null;
  window.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (!t.matches('input[type="search"], #q, #search, [data-search]')) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var v = (t.value || "").trim();
      if (v.length < 2) return;
      track("search", { query: v.slice(0, 100), results: countResults() });
    }, 900);
  }, true);

  function countResults() {
    var g = document.querySelector("#ggrid, #grid, [data-results]");
    return g ? g.children.length : undefined;
  }

  window.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('input[type="search"], [data-search]')) return;
    if (!t.matches("select, input[type=checkbox], input[type=radio], input[type=range]")) return;
    var name = t.id || t.name || t.getAttribute("data-filter") || "";
    if (!name) return;
    track("filter_used", {
      filter: name.slice(0, 60),
      value: String(t.type === "checkbox" ? t.checked : t.value).slice(0, 60)
    });
  }, true);

  window.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || !f.querySelector) return;
    var email = f.querySelector('input[type="email"]');
    if (email) track("newsletter_signup", { source: f.id || f.className || "form" });
    else track("form_submit", { form: (f.id || f.name || "form").slice(0, 60) });
  }, true);

  /* ---- PWA install ------------------------------------------------------- */

  window.addEventListener("appinstalled", function () { track("pwa_install", {}); });
  window.addEventListener("beforeinstallprompt", function () { track("pwa_prompt_shown", {}); });

  /* ---- errors ------------------------------------------------------------
     A blank grid caused by one thrown exception looks identical to a quiet day
     in a traffic report. Capping at 5 per page keeps a loop from becoming the
     entire dataset. */

  var ERRS = 0;
  window.addEventListener("error", function (e) {
    if (ERRS++ > 5) return;
    track("js_error", {
      message: String(e.message || "").slice(0, 200),
      source: String(e.filename || "").slice(0, 160) + ":" + (e.lineno || 0)
    });
  });
  window.addEventListener("unhandledrejection", function (e) {
    if (ERRS++ > 5) return;
    var r = e.reason;
    track("js_error", { message: String((r && r.message) || r || "").slice(0, 200), source: "promise" });
  });

  /* ---- web vitals --------------------------------------------------------
     Hand-rolled rather than pulling the web-vitals package, because three of
     these four sites have no bundler on purpose. The thresholds are Google's
     published good/needs-improvement boundaries. */

  function vital(metric, value, good, poor, round) {
    track("web_vital", {
      metric: metric,
      value: round ? Math.round(value * round) / round : Math.round(value),
      rating: value <= good ? "good" : value <= poor ? "needs-improvement" : "poor"
    });
  }

  /* Each observer gets its own try. Sharing one would mean that the first
     unsupported entry type takes the rest down with it: Safari has no
     layout-shift, and a single shared block would silently cost us LCP there
     even though Safari reports it perfectly well. */
  function observe(type, fn, extra) {
    try {
      var opts = { type: type, buffered: true };
      for (var k in extra) opts[k] = extra[k];
      new PerformanceObserver(fn).observe(opts);
    } catch (e) {}
  }

  var lcp = 0, cls = 0, inp = 0;

  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav) addEventListener("load", function () { vital("TTFB", nav.responseStart, 800, 1800); });
  } catch (e) {}

  observe("largest-contentful-paint", function (l) {
    var es = l.getEntries(); lcp = es[es.length - 1].startTime;
  });
  observe("layout-shift", function (l) {
    l.getEntries().forEach(function (en) { if (!en.hadRecentInput) cls += en.value; });
  });
  observe("event", function (l) {
    l.getEntries().forEach(function (en) { if (en.duration > inp) inp = en.duration; });
  }, { durationThreshold: 40 });

  /* Reported once, at the point the page goes away, because all three of these
     keep changing until then. Registered on the finalizer so the events are
     queued before the last flush, not after it. */
  var vitalsDone = false;
  FINAL.push(function () {
    if (vitalsDone) return;
    vitalsDone = true;
    if (lcp) vital("LCP", lcp, 2500, 4000);
    if (cls) vital("CLS", cls, 0.1, 0.25, 1000);   /* unitless, so keep 3 decimals */
    if (inp) vital("INP", inp, 200, 500);
  });

  /* ============================================================================
     PUBLIC API
     Legal-Leaf's pages already call LL.track in about twenty places, inside
     page scripts we do not want to re-cut. Those pages also RE-ASSIGN LL.track
     further down the body. Defining it as an accessor with a no-op setter
     means the later assignment is silently ignored instead of clobbering us,
     and, critically, does not throw: a plain non-writable property would
     TypeError under the "use strict" in those page scripts and take the whole
     catalogue down with it.
     ========================================================================= */

  function claim(ns) {
    var o = window[ns] = window[ns] || {};
    try {
      Object.defineProperty(o, "track", { get: function () { return track; }, set: function () {}, configurable: false });
    } catch (e) {
      o.track = track;
    }
    return o;
  }

  var API = { track: track, flush: function () { flush(true); }, config: CFG, visitor: VID, session: SES.id };
  window.SA = API;
  claim("LL");   /* Legal-Leaf  */
  claim("NM");   /* Nicotia     */
  claim("HLM");  /* Herbal Leaf */
  claim("KK");   /* KawaiiKatz  */

  /* ---- go ---------------------------------------------------------------- */

  window.addEventListener("scroll", onScroll, { passive: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { pageView("initial"); });
  else pageView("initial");
})();
