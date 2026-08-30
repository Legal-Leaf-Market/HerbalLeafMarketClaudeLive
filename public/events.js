/* =========================================================================
 * events.js — first-party analytics for what this shop is actually doing.
 *
 * WHY THIS EXISTS ALONGSIDE hlmLogClick()
 *
 * `hlmLogClick` writes the money log: one row per hand-off, kept for the
 * weekly click report and for partner negotiation. It answers "what did
 * people leave for" and it answers it well.
 *
 * It cannot answer "where did people give up", because it has no way to tell
 * two visits apart. Four hundred ritual builders opened and twelve baskets
 * filled is a fact about two numbers; whether those were the same four
 * hundred people is a fact about ORDER, and only a session id carries it.
 * That is the whole reason for this file.
 *
 * Both keep running. This does not replace the click log and must not: the
 * click log carries price and email and is the record the reports are built
 * on, and this one is deliberately forbidden from carrying either.
 *
 * THE PRIVACY CEILING, AND IT IS A CEILING RATHER THAN A STARTING POINT
 *
 * `sid` is a random value in sessionStorage. It dies when the tab closes, is
 * never sent anywhere but this origin, and cannot follow a person between
 * visits or across devices. No IP, no cookie, no email, no account, no
 * fingerprint. It exists only so a funnel can tell one visit's steps from
 * another's, which is the minimum that makes "where do people give up"
 * answerable at all. /privacy describes exactly this; if you widen what is
 * collected here, that page is wrong in the same commit.
 *
 * OUR CLICKS ARE NOT THEIR SALES
 *
 * We never take an order, so we cannot see what sold. The furthest thing
 * observable is `outbound_click`, the moment somebody leaves for a maker.
 * Every number this feeds means "most clicked here", never "most bought",
 * and the admin page says so rather than letting the reader assume.
 * ====================================================================== */
(function (w, d) {
  "use strict";

  var SID_KEY = "hlm_sid";
  var ENDPOINT = "/api/events";
  var MAX_BATCH = 20;

  /* Queued and flushed rather than one request per event. A shopper opening
     six cards would otherwise be six round trips, and on a slow connection
     that is bandwidth taken from the pictures. */
  var queue = [];
  var timer = null;

  function sid() {
    try {
      var v = w.sessionStorage.getItem(SID_KEY);
      if (!v) {
        /* crypto.randomUUID is not on older Safari, and this must never be
           the thing that throws on a shopper's phone. */
        v = (w.crypto && w.crypto.randomUUID)
          ? w.crypto.randomUUID()
          : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);
        w.sessionStorage.setItem(SID_KEY, v);
      }
      return v;
    } catch (e) {
      /* Private mode, or storage disabled. No id means no funnel, and that
         is the correct outcome: we do not fall back to anything stickier. */
      return "";
    }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var id = sid();
    if (!id) { queue.length = 0; return; }

    var body = JSON.stringify({ sid: id, events: queue.splice(0, MAX_BATCH) });

    /* sendBeacon survives the page being closed, which is exactly when the
       most interesting event of a visit fires: the click that leaves. */
    try {
      if (w.navigator && w.navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        if (w.navigator.sendBeacon(ENDPOINT, blob)) return;
      }
    } catch (e) { /* fall through to fetch */ }

    try {
      w.fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* analytics never breaks the page */ }
  }

  /* Small delay so a burst coalesces, but short enough that a click which
     navigates away has usually already gone. The unload flush below is the
     safety net for the ones that have not. */
  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, 900);
  }

  function track(name, fields) {
    if (!name) return;
    var e = fields || {};
    queue.push({
      name: String(name),
      page: String(e.page || (d.location && d.location.pathname) || ""),
      product: String(e.product || ""),
      vendor: String(e.vendor || ""),
      cat: String(e.cat || ""),
      meta: String(e.meta || ""),
    });
    /* The hand-off is the one event worth a round trip of its own: the tab
       may be gone a moment later. */
    if (name === "outbound_click" || name === "checkout_click") flush();
    else schedule();
  }

  /* pagehide rather than unload: unload is ignored by the back/forward cache
     on iOS, so a shopper who swipes back loses the whole tail of the visit. */
  d.addEventListener("visibilitychange", function () {
    if (d.visibilityState === "hidden") flush();
  });
  w.addEventListener("pagehide", flush);

  w.HLMTrack = track;

  /* One page_view per load, after the age gate has been dealt with: counting
     views that never got past the gate would put a step in every funnel that
     nobody chose to take. */
  function firstView() {
    track("page_view", { meta: d.referrer && d.referrer.indexOf(location.host) < 0 ? "external" : "" });
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", firstView);
  else firstView();
})(window, document);
