/* HLM: focus / "zoom to card" from email deep links (?focus=<id> or #<id>)
 *
 * WHY THIS REWRITE:
 *   app.js renders the grid several times (seed products, then again once live
 *   inventory merges, plus on filter changes). The previous version used a
 *   MutationObserver that fired a NEW smooth scroll on every mutation; those
 *   smooth scrolls interrupted each other (compounded by html{scroll-behavior:
 *   smooth} + the sticky header), so it "tried" but never settled on the card.
 *
 * NEW APPROACH — deterministic & event-driven:
 *   app.js now dispatches document event "hlm:render" after each render and
 *   "hlm:inventory" once live inventory is merged. We DEBOUNCE those events and
 *   perform ONE authoritative scroll after the DOM goes quiet, using a manual
 *   header-aware offset (no reliance on scroll-behavior). We verify the landing
 *   and make at most a couple of instant corrections. We back off the instant
 *   the shopper scrolls/taps, and (if app.js is an older build with no events)
 *   we fall back to polling. If the item genuinely isn't on the page after
 *   inventory loads, we surface a gentle toast instead of silently sitting at
 *   the top.
 */
(function () {
  function getFocusId() {
    try {
      var p = new URLSearchParams(location.search);
      var f = p.get("focus");
      if (f) return f;
      if (location.hash && location.hash.length > 1) return decodeURIComponent(location.hash.slice(1));
    } catch (e) {}
    return "";
  }
  var FOCUS_ID = getFocusId();
  if (!FOCUS_ID) return;

  var done = false;          // finished (landed or gave up)
  var userInterrupted = false;
  var debounceTimer = null;
  var verifyTimers = [];
  var pollIv = null;
  var hardStop = null;
  var lastNode = null;

  function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, "\\$&"); }
  function handleOf(id) { var i = id.indexOf("-"); return i > 0 ? id.slice(i + 1) : id; }

  function findCard(id) {
    var el = document.getElementById(id);
    if (el) return (el.classList && el.classList.contains("card")) ? el : (el.closest ? el.closest(".card") : el);
    var d = document.querySelector('[data-id="' + esc(id) + '"]');
    if (d) return d.closest ? (d.closest(".card") || d) : d;
    var handle = handleOf(id);
    if (handle) {
      var links = document.querySelectorAll("#grid a[href]");
      for (var k = 0; k < links.length; k++) {
        var h = links[k].getAttribute("href") || "";
        if (h.indexOf("/products/" + handle) > -1) return links[k].closest ? links[k].closest(".card") : null;
      }
    }
    return null;
  }

  function headerOffset() {
    var h = document.querySelector("header");
    var hh = h ? (h.getBoundingClientRect().height || 0) : 0;
    return hh + 14; // small breathing room under the sticky header
  }

  // Manual, header-aware centering scroll (does not depend on scroll-behavior).
  function scrollToCard(card, smooth) {
    var rect = card.getBoundingClientRect();
    var pageY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var target = pageY + rect.top - Math.max(headerOffset(), (vh - rect.height) / 2);
    if (target < 0) target = 0;
    try { window.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" }); }
    catch (e) { window.scrollTo(0, target); }
  }

  function highlight(card) {
    card.classList.remove("hlm-focus");
    void card.offsetWidth;            // restart the zoom animation
    card.classList.add("hlm-focus");
  }

  function isCentered(card) {
    var rect = card.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    var mid = rect.top + rect.height / 2;
    return mid > headerOffset() && mid < vh - 40; // roughly on-screen below the header
  }

  // The one authoritative pass: scroll smooth, then verify & instant-correct.
  function land() {
    if (done || userInterrupted) return;
    var card = findCard(FOCUS_ID);
    if (!card) return;

    var isNew = card !== lastNode;

    // Idempotent: if we're already on the same, correctly-centered & highlighted
    // card, don't re-scroll or re-pulse. Finish once inventory has settled.
    if (!isNew && card.classList.contains("hlm-focus") && isCentered(card)) {
      if (window.__hlmInvLoaded) setTimeout(function () { finish(true); }, 400);
      return;
    }

    lastNode = card;
    scrollToCard(card, true);
    highlight(card);

    // clear any pending verifications and schedule fresh ones
    verifyTimers.forEach(clearTimeout); verifyTimers = [];
    [350, 900, 1500].forEach(function (t) {
      verifyTimers.push(setTimeout(function () {
        if (done || userInterrupted) return;
        var c = findCard(FOCUS_ID);
        if (!c) return;
        if (c !== lastNode) { lastNode = c; highlight(c); }
        if (!isCentered(c)) scrollToCard(c, false); // instant correction if the grid moved it
      }, t));
    });

    // If inventory is already loaded and this is a stable node, we can finish soon.
    if (window.__hlmInvLoaded && !isNew) {
      setTimeout(function () { finish(true); }, 1700);
    }
  }

  function schedule() {
    if (done || userInterrupted) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(land, 130); // let the render paint, then act once
  }

  function finish(landed) {
    if (done) return;
    done = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    verifyTimers.forEach(clearTimeout); verifyTimers = [];
    if (pollIv) { clearInterval(pollIv); pollIv = null; }
    if (hardStop) { clearTimeout(hardStop); hardStop = null; }
    if (!landed) notFound();
    teardownUserWatch();
  }

  // Gentle fallback if the item simply isn't on the page (out of stock/filtered).
  function notFound() {
    if (findCard(FOCUS_ID)) return; // it's actually here; nothing to say
    try {
      if (typeof window.hlmToast === "function") {
        window.hlmToast("That find isn't showing right now — it may be sold out.");
      }
    } catch (e) {}
  }

  /* -------- user-intent detection: stop hijacking the scroll -------- */
  function onUserIntent(e) {
    // ignore the programmatic smooth-scroll's own scroll events by only
    // treating explicit input gestures as "user took over"
    userInterrupted = true;
    finish(true);
  }
  var NAV_KEYS = { PageUp:1, PageDown:1, ArrowUp:1, ArrowDown:1, Home:1, End:1, " ":1, Spacebar:1 };
  function onKey(e) { if (NAV_KEYS[e.key]) onUserIntent(e); }
  function setupUserWatch() {
    window.addEventListener("wheel", onUserIntent, { passive: true });
    window.addEventListener("touchmove", onUserIntent, { passive: true });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onUserIntent, true);
  }
  function teardownUserWatch() {
    window.removeEventListener("wheel", onUserIntent);
    window.removeEventListener("touchmove", onUserIntent);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onUserIntent, true);
  }

  function start() {
    setupUserWatch();

    // Primary path: app.js render/inventory events.
    document.addEventListener("hlm:render", schedule);
    document.addEventListener("hlm:inventory", function () {
      schedule();
      // after inventory has merged, give it a moment then decide found/not-found
      setTimeout(function () {
        if (done || userInterrupted) return;
        if (findCard(FOCUS_ID)) { land(); setTimeout(function () { finish(true); }, 1800); }
        else finish(false);
      }, 500);
    });

    // Re-focus when the 21+ gate is dismissed or the loader hides (layout shifts).
    var gate = document.getElementById("ageGate");
    if (gate) {
      var gObs = new MutationObserver(function () {
        if (gate.classList.contains("hidden") || gate.style.display === "none") { schedule(); try { gObs.disconnect(); } catch (e) {} }
      });
      try { gObs.observe(gate, { attributes: true, attributeFilter: ["class", "style"] }); } catch (e) {}
    }
    var loader = document.getElementById("hlmLoader");
    if (loader) {
      var lObs = new MutationObserver(function () {
        if (loader.classList.contains("hide")) { schedule(); try { lObs.disconnect(); } catch (e) {} }
      });
      try { lObs.observe(loader, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
    }

    // Kick once for the initial (seed) render.
    schedule();

    // Fallback polling for older app.js builds that don't emit events.
    var tries = 0, MAX = 80; // ~24s
    pollIv = setInterval(function () {
      if (done || userInterrupted) { clearInterval(pollIv); pollIv = null; return; }
      tries++;
      if (findCard(FOCUS_ID)) { land(); }
      if (tries > MAX) { finish(!!findCard(FOCUS_ID)); }
    }, 300);

    // Absolute cap.
    hardStop = setTimeout(function () { finish(!!findCard(FOCUS_ID)); }, 26000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
