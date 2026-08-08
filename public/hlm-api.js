/* hlm-api.js — drop-in shim so existing Apps Script front-end code keeps working.
 * Include this ONCE in every page BEFORE your app code:
 *     <script src="/hlm-api.js"></script>
 *
 * It recreates google.script.run.<fn>(args)
 *   .withSuccessHandler(cb)
 *   .withFailureHandler(cb)
 * by POSTing {fn, args} to /api/rpc on this same Worker.
 *
 * Fast paths (cached, GET): getInventory() and getSmokingBlendsIds() hit
 * /api/inventory and /api/nss-ids directly.
 */
(function () {
  window.google = window.google || {};
  window.google.script = window.google.script || {};

  var GET_ROUTES = {
    getInventory: "/api/inventory",
    getSmokingBlendsIds: "/api/nss-ids"
  };

  async function callRpc(fn, args) {
    // Fast GET path for cached, no-arg reads
    if (GET_ROUTES[fn] && (!args.length || fn === "getSmokingBlendsIds")) {
      var res = await fetch(GET_ROUTES[fn], { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(fn + " " + res.status);
      return await res.json();
    }
    var r = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn: fn, args: args })
    });
    if (!r.ok) throw new Error(fn + " " + r.status);
    return await r.json();
  }

  function makeRunner() {
    var successCb = null, failureCb = null;
    var runner = new Proxy({}, {
      get: function (_t, prop) {
        if (prop === "withSuccessHandler") return function (cb) { successCb = cb; return runner; };
        if (prop === "withFailureHandler") return function (cb) { failureCb = cb; return runner; };
        if (prop === "then") return undefined; // not a thenable
        return function () {
          var args = Array.prototype.slice.call(arguments);
          callRpc(prop, args)
            .then(function (out) { if (successCb) successCb(out); })
            .catch(function (err) { if (failureCb) failureCb(err); else console.error(err); });
          return undefined; // matches Apps Script (void) semantics
        };
      }
    });
    return runner;
  }

  // google.script.run is a fresh runner each access, like the real API.
  Object.defineProperty(window.google.script, "run", {
    get: function () { return makeRunner(); },
    configurable: true
  });

  // Optional promise-based helper if you'd rather await:  await HLM.call('hlmWatchItem', payload)
  window.HLM = { call: function (fn) { return callRpc(fn, Array.prototype.slice.call(arguments, 1)); } };
})();
