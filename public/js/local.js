/* HERBAL LEAF LOCAL — shelf and shopping list.
 *
 * WHY A LIST AND NOT A CART, which is the whole design.
 *
 * A cart exists to be checked out, and these shops have nothing to check out
 * to: no Shopify, no online payment, in several cases no website. Legal Leaf
 * hit this first with counter-only dispensaries and the answer there is the
 * same as the answer here, written into that page in as many words: the
 * deliverable is a route with a list per stop, and it is the thing somebody
 * actually holds in the shop.
 *
 * So: a list. It groups by shop because a list that spans shops is a set of
 * errands rather than an order, and it lives at its own address because that
 * address can be a homescreen shortcut and works with no signal in a shop with
 * thick walls.
 *
 * NAMESPACED PER TOWN, and that is Coldwater's scar rather than a preference.
 * Two towns are two trips: a jar added in Nashville and a jar added in Seymour
 * are not one shopping list, they are two mornings. Merging them silently
 * loses one of them at the moment somebody is standing in a shop.
 */
(function (w) {
  "use strict";

  var KEY_BASE = "hlm_local:";

  function shops() { return w.LOCAL_SHOPS || []; }
  function catalog() { return w.LOCAL_PRODUCTS || {}; }

  /* An unlisted shop with products in the file is the one bug in this system
   * that cannot be allowed to ship, because it publishes a shop's prices
   * without the shop having agreed. Checked at load, loudly, rather than
   * trusted: the file is edited by hand and a hand is what will get it wrong.
   * The products are dropped, not just complained about. */
  function localCheck() {
    var cat = catalog(), bad = [];
    shops().forEach(function (s) {
      if (!s.listed && cat[s.id] && cat[s.id].length) {
        bad.push(s.id);
        delete cat[s.id];
      }
    });
    if (bad.length && w.console) {
      console.error("[local] products dropped for shops that have not agreed to be listed: " + bad.join(", "));
    }
    return bad;
  }

  function shopById(id) {
    var all = shops();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function productsFor(id) {
    var s = shopById(id);
    if (!s || !s.listed) return [];
    return (catalog()[id] || []).slice();
  }

  /* States that actually have something, counted from the registry so a
   * visible choice can never land on an empty page. Same rule the national
   * shelf's facets follow. */
  function states() {
    var seen = {};
    shops().forEach(function (s) {
      var e = seen[s.state] || (seen[s.state] = { code: s.state, name: s.stateName || s.state, shops: 0, listed: 0 });
      e.shops++;
      if (s.listed) e.listed++;
    });
    return Object.keys(seen).map(function (k) { return seen[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function towns(stateCode) {
    var seen = {};
    shops().forEach(function (s) {
      if (stateCode && s.state !== stateCode) return;
      var e = seen[s.town] || (seen[s.town] = { town: s.town, state: s.state, shops: [] });
      e.shops.push(s);
    });
    return Object.keys(seen).map(function (k) { return seen[k]; })
      .sort(function (a, b) { return a.town.localeCompare(b.town); });
  }

  /* ------------------------------------------------------------ the list */

  function keyFor(town) { return KEY_BASE + String(town || "").toLowerCase().replace(/\s+/g, "-"); }

  function read(town) {
    try {
      var v = JSON.parse(w.localStorage.getItem(keyFor(town)) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function write(town, rows) {
    try { w.localStorage.setItem(keyFor(town), JSON.stringify(rows)); } catch (e) {}
    try { w.dispatchEvent(new CustomEvent("hlm:list", { detail: { town: town, n: rows.length } })); } catch (e) {}
  }

  function add(town, shopId, productId, qty) {
    var rows = read(town);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].shop === shopId && rows[i].id === productId) {
        rows[i].qty += (qty || 1);
        write(town, rows);
        return rows;
      }
    }
    rows.push({ shop: shopId, id: productId, qty: qty || 1 });
    write(town, rows);
    return rows;
  }

  function setQty(town, shopId, productId, qty) {
    var rows = read(town).filter(function (r) {
      if (r.shop !== shopId || r.id !== productId) return true;
      r.qty = qty;
      return qty > 0;
    });
    write(town, rows);
    return rows;
  }

  function clear(town) { write(town, []); }

  function count(town) {
    return read(town).reduce(function (n, r) { return n + (r.qty || 0); }, 0);
  }

  /* Rows joined back to products and grouped by shop, which is the shape both
   * the list page and the order payload want. Anything whose product has since
   * vanished from the file is dropped rather than rendered as a blank line. */
  function grouped(town) {
    var rows = read(town), byShop = {};
    rows.forEach(function (r) {
      var s = shopById(r.shop);
      if (!s || !s.listed) return;
      var p = null, list = catalog()[r.shop] || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === r.id) { p = list[i]; break; }
      if (!p) return;
      var g = byShop[r.shop] || (byShop[r.shop] = { shop: s, items: [], total: 0 });
      var line = { p: p, qty: r.qty, line: (Number(p.price) || 0) * r.qty };
      g.items.push(line);
      g.total += line.line;
    });
    return Object.keys(byShop).map(function (k) { return byShop[k]; });
  }

  function money(n) { return "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* A list is a thing people send to each other, so it has to survive being
   * pasted into a text message with no styling at all. */
  function asText(town) {
    var out = [];
    grouped(town).forEach(function (g) {
      out.push(g.shop.name + (g.shop.demo ? " (sample shop)" : ""));
      if (g.shop.address) out.push("  " + g.shop.address);
      g.items.forEach(function (it) {
        out.push("  " + it.qty + " x " + it.p.name + (it.p.size ? " (" + it.p.size + ")" : "") + "  " + money(it.line));
      });
      out.push("  Estimate: " + money(g.total));
      out.push("");
    });
    if (!out.length) return "";
    out.push("Prices are what the shop last confirmed. The shop's own total is the one that counts.");
    out.push("herballeafmarket.com/local");
    return out.join("\n");
  }

  w.HLMLocal = {
    localCheck: localCheck, shops: shops, shopById: shopById, productsFor: productsFor,
    states: states, towns: towns,
    read: read, add: add, setQty: setQty, clear: clear, count: count,
    grouped: grouped, asText: asText, money: money, esc: esc, keyFor: keyFor,
  };
})(window);
