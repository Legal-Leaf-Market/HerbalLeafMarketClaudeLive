/* Deck page engine: the live shop's product card, rendered for one maker.
 *
 * A deck page asks somebody who never applied to be listed whether they want
 * to be. The only fair way to ask is to show them the real thing, so the card
 * here is a port of render() in public/app.js rather than a simplified stand
 * in: same flip, same full-screen photo with the click-to-zoom, same variant
 * select with sold-out options disabled, same description on the back, same
 * spec table.
 *
 * WHAT IS DELIBERATELY NOT PORTED, because none of it is true yet for a maker
 * on deck: the wishlist (nothing to save to), the coupon pill (they have not
 * issued a code and HLM_DEFAULT_RULES has them at percent:0), the COA link
 * (only Secret Nature has joined certificates), the affiliate rewrite on
 * outbound links (no referral code exists, so every link here is direct and
 * unattributed, which is the honest state), and the login gate before
 * checkout. Adding any of them would show the maker a promise the site is not
 * currently keeping for them.
 *
 * The cart IS ported, because it is the one part of the shopping experience a
 * maker most needs to see: it demonstrates that we never take the order. It
 * totals an estimate and then hands off to their own checkout.
 *
 * Config comes from window.HLM_DECK, set by each page. */
(function () {
  "use strict";

  var CFG = window.HLM_DECK || {};
  var VENDOR = CFG.vendor || "";
  var ROWS = [];
  var SELV = {};        // product id -> chosen variant index
  var CART = {};        // product id -> {p, vi, qty}

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(n) { return "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

  /* Shopify serves a _NNNx image by inserting the size before the extension.
   * Same trick app.js uses to pull a bigger file for the zoom view than the
   * card thumbnail needs. */
  function hiRes(src) {
    if (!src) return src;
    var m = String(src).match(/^(.*)(\.(?:jpg|jpeg|png|webp|gif))(\?.*)?$/i);
    if (!m) return src;
    if (/_\d+x\d*(\.|$)/.test(m[1])) return src;
    return m[1] + "_1946x" + m[2] + (m[3] || "");
  }

  /* A <select> will happily render a disabled option as the selection if told
   * to, which is how sold-out sizes reached carts on the live site. Land the
   * default on something the maker can actually sell. */
  function availableIdx(p, want) {
    var v = p.variants || [];
    if (v[want] && v[want].available !== false) return want;
    for (var i = 0; i < v.length; i++) if (v[i].available !== false) return i;
    return -1;
  }
  function chosen(p) {
    var i = SELV[p.id];
    if (i == null) { i = availableIdx(p, 0); if (i < 0) i = 0; }
    return (p.variants && p.variants[i]) || null;
  }

  /* ---------------- full-screen photo ---------------- */
  var zOv, zPic, zCap, zOpen = false, zLast = null;

  function zBuild() {
    if (zOv) return;
    zOv = document.createElement("div");
    zOv.id = "hlmZoom";
    zOv.setAttribute("role", "dialog");
    zOv.setAttribute("aria-modal", "true");
    zOv.setAttribute("aria-label", "Product photo");
    zOv.innerHTML = '<button id="hlmZoomX" type="button" aria-label="Close photo">×</button>' +
      '<div id="hlmZoomWrap"><img alt=""></div><div id="hlmZoomCap"></div>';
    document.body.appendChild(zOv);
    zPic = zOv.querySelector("img");
    zCap = zOv.querySelector("#hlmZoomCap");
    zPic.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!hitsPicture(e)) { zClose(); return; }
      zPic.classList.toggle("zoomed");
    });
    zPic.addEventListener("load", capToNatural);
    zOv.addEventListener("click", zClose);
    zOv.querySelector("#hlmZoomX").addEventListener("click", function (e) {
      e.stopPropagation(); zClose();
    });
  }

  /* The backdrop has a dead zone without this. The <img> fills the wrapper and
   * object-fit:contain letterboxes the picture inside it, so the element box is
   * bigger than the painted picture and a click on the letterbox reads as a
   * click on the image. Work out the painted rect and treat everything outside
   * it as backdrop.
   *
   * A CLICK WITHOUT A POINTER HAS NO COORDINATES. Keyboard activation and
   * synthetic clicks arrive with detail 0 and clientX/clientY at 0,0, which is
   * the top-left corner and therefore always outside the painted rect. Treating
   * those as backdrop closed the viewer the instant it was opened from the
   * keyboard. Ported with the guard intact; it was a real regression on the
   * live site. */
  function hitsPicture(e) {
    if (!e.detail) return true;
    var nw = zPic.naturalWidth || 0, nh = zPic.naturalHeight || 0;
    if (!nw || !nh) return true;
    var r = zPic.getBoundingClientRect();
    if (!r.width || !r.height) return true;
    var scale = Math.min(r.width / nw, r.height / nh);
    var pw = nw * scale, ph = nh * scale;
    var px = r.left + (r.width - pw) / 2, py = r.top + (r.height - ph) / 2;
    return e.clientX >= px && e.clientX <= px + pw && e.clientY >= py && e.clientY <= py + ph;
  }

  /* Stop the 2.2x zoom growing past twice the file's own pixels, so a small
   * photo turns to mush at a predictable point rather than filling the screen
   * with blur. */
  function capToNatural() {
    var nw = zPic.naturalWidth || 0, nh = zPic.naturalHeight || 0;
    if (!nw || !nh) { zPic.style.maxWidth = ""; zPic.style.maxHeight = ""; return; }
    zPic.style.maxWidth = (nw * 2) + "px";
    zPic.style.maxHeight = (nh * 2) + "px";
  }

  function zOpenPhoto(src, label) {
    zBuild();
    var want = hiRes(src);
    zPic.onerror = (want === src) ? null : function () { zPic.onerror = null; zPic.src = src; };
    zPic.style.maxWidth = ""; zPic.style.maxHeight = "";
    zPic.src = want;
    zPic.alt = label || "Product photo";
    zPic.classList.remove("zoomed");
    zCap.textContent = label || "";
    zOv.classList.add("on");
    zOpen = true;
    zLast = document.activeElement;
    document.body.style.overflow = "hidden";
    try { zOv.querySelector("#hlmZoomX").focus(); } catch (e) {}
  }
  function zClose() {
    if (!zOv || !zOpen) return;
    zOv.classList.remove("on");
    zOpen = false;
    zPic.classList.remove("zoomed");
    zPic.removeAttribute("src");
    document.body.style.overflow = "";
    try { if (zLast && zLast.focus) zLast.focus(); } catch (e) {}
  }

  /* ---------------- cart ---------------- */
  function cartCount() {
    return Object.keys(CART).reduce(function (n, k) { return n + CART[k].qty; }, 0);
  }
  function cartAdd(id) {
    var p = byId(id); if (!p) return;
    var vi = SELV[id]; if (vi == null) { vi = availableIdx(p, 0); if (vi < 0) vi = 0; }
    var key = id + "::" + vi;
    if (CART[key]) CART[key].qty++;
    else CART[key] = { p: p, vi: vi, qty: 1 };
    paintCartBtn();
    openCart();
  }
  function cartDrop(key) { delete CART[key]; paintCartBtn(); paintCart(); }

  function paintCartBtn() {
    var b = $("deckCartBtn"); if (!b) return;
    var n = cartCount();
    b.classList.toggle("on", n > 0);
    b.innerHTML = 'Cart <b>' + n + '</b>';
  }
  function openCart() { var c = $("deckCart"); if (c) { c.classList.add("on"); paintCart(); } }
  function closeCart() { var c = $("deckCart"); if (c) c.classList.remove("on"); }

  function paintCart() {
    var body = $("deckCartBody"), foot = $("deckCartFoot");
    if (!body) return;
    var keys = Object.keys(CART);
    if (!keys.length) {
      body.innerHTML = '<div class="cart-empty">Nothing in the cart yet.<br>Add one of your own products to see how it works.</div>';
      if (foot) foot.innerHTML = "";
      return;
    }
    var sub = 0;
    body.innerHTML = keys.map(function (k) {
      var it = CART[k], v = (it.p.variants || [])[it.vi];
      var price = (v ? Number(v.price) : Number(it.p.price)) || 0;
      sub += price * it.qty;
      var vt = v && v.title ? v.title : "";
      return '<div class="cart-row">' +
        (it.p.image ? '<img src="' + esc(it.p.image) + '" alt="" loading="lazy">' : '<img alt="">') +
        '<div><p class="cr-n">' + esc(it.p.name) + '</p>' +
        '<p class="cr-v">' + (vt ? esc(vt) + ' &middot; ' : '') + it.qty + ' &times; ' + money(price) + '</p>' +
        '<button type="button" data-drop="' + esc(k) + '">Remove</button></div>' +
        '<div class="cr-p">' + money(price * it.qty) + '</div></div>';
    }).join("");
    if (foot) {
      foot.innerHTML =
        '<div class="ln"><span>Subtotal</span><b>' + money(sub) + '</b></div>' +
        '<div class="ln"><span>Shipping</span><b>' + esc(CFG.shippingLabel || "Shown at your checkout") + '</b></div>' +
        '<div class="ln tot"><span>Estimate</span><b>' + money(sub) + '</b></div>' +
        '<a class="cart-go" href="' + esc(CFG.shopUrl || "#") + '" target="_blank" rel="noopener nofollow">Continue to ' + esc(CFG.domain || "your shop") + ' ↗</a>' +
        '<p class="cart-note">This is the whole of it. We never take the order: the cart is an estimate and the button above hands the shopper to your own checkout, with your prices and your shipping. Nothing on our side sees their card.</p>';
    }
  }

  /* ---------------- cards ---------------- */
  function byId(id) {
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i].id === id) return ROWS[i];
    return null;
  }

  function cardHTML(p) {
    var v = chosen(p);
    var price = (v ? Number(v.price) : Number(p.price)) || 0;
    var multi = p.variants && p.variants.length > 1;
    var inStock = p.inStock !== false;

    var fromTxt = (p.unit === "from" && !multi) ? '<span class="from">from</span>' : "";
    var priceHtml = '<span class="price" id="price-' + esc(p.id) + '">' + fromTxt + money(price) + '</span>';

    var ph = '<div class="thumb-ph"><span>' + esc(p.name) + '</span></div>';
    var expand = '<button type="button" class="hlm-expand" aria-label="Expand photo to full view" title="Expand to full view" data-zoom="' + esc(p.id) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"/></svg></button>';
    /* If the photo 404s, drop the <img> and the expand button together: an
     * expand control over a placeholder opens an empty viewer. */
    var imgHtml = p.image
      ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" onerror="var t=this.parentNode;t.classList.add(\'noimg\');this.remove();var e=t.querySelector(\'.hlm-expand\');if(e)e.remove();">' + ph + expand
      : ph;

    var stock = '<span class="stockbadge' + (inStock ? '' : ' out') + '">' + (inStock ? 'In stock' : 'Sold out') + '</span>';
    var badge = p.category ? '<span class="badge">' + esc(p.category) + '</span>' : "";

    var tags = [];
    if (multi) tags.push('<span class="tag">' + p.variants.length + ' options</span>');
    if (CFG.localLabel) tags.push('<span class="tag local">' + esc(CFG.localLabel) + '</span>');
    if (CFG.shipsLabel) tags.push('<span class="tag">' + esc(CFG.shipsLabel) + '</span>');
    var tagHtml = tags.length ? '<div class="tags">' + tags.join("") + '</div>' : "";

    var sizeHtml = "";
    if (multi) {
      var sel = availableIdx(p, SELV[p.id] || 0);
      if (sel < 0) sel = SELV[p.id] || 0;
      sizeHtml = '<select class="size-sel" data-sel="' + esc(p.id) + '" aria-label="Choose size">' +
        p.variants.map(function (vv, i) {
          var lbl = (vv.title || ("Option " + (i + 1))) + " - " + money(vv.price) + (vv.available === false ? " (sold out)" : "");
          return '<option value="' + i + '"' + (i === sel ? " selected" : "") + (vv.available === false ? " disabled" : "") + '>' + esc(lbl) + '</option>';
        }).join("") + '</select>';
    }

    var sizesTxt = "";
    if (multi) {
      var ps = p.variants.map(function (x) { return Number(x.price) || 0; }).filter(function (n) { return n > 0; });
      sizesTxt = p.variants.length + " options" + (ps.length ? (" from " + money(Math.min.apply(null, ps))) : "");
    }

    var spec = '<dl class="bk-spec">' +
      '<dt>Maker</dt><dd>' + esc(p.vendor) + '</dd>' +
      (p.category ? '<dt>Category</dt><dd>' + esc(p.category) + '</dd>' : "") +
      (sizesTxt ? '<dt>Sizes</dt><dd>' + esc(sizesTxt) + '</dd>' : "") +
      '<dt>Stock</dt><dd>' + (inStock ? "In stock" : "Sold out") + '</dd>' +
      '<dt>Shipping</dt><dd>' + esc(CFG.shippingLabel || "Shown at your checkout") + '</dd>' +
      '</dl>';

    var desc = p.blurb
      ? '<p class="bk-desc">' + esc(p.blurb) + '</p>'
      : '<p class="bk-desc none">Your shop publishes no description for this one, so the back of the card is thin. Anything you write on your own product page appears here automatically.</p>';

    var back = '<div class="card-face card-back"><div class="back-in">' +
      '<div class="bk-vendor">' + esc(p.vendor) + '</div>' +
      '<h4>' + esc(p.name) + '</h4>' + desc + spec +
      '</div><div class="back-foot">' +
      '<a class="bk-add" href="' + esc(p.url) + '" target="_blank" rel="noopener nofollow">Open on your site ↗</a>' +
      '<button type="button" class="card-turnback" data-flip="1" aria-label="Turn back to the front">↩</button>' +
      '</div></div>';

    return '<article class="card" id="c-' + esc(p.id) + '" data-id="' + esc(p.id) + '">' +
      '<div class="card-in">' +
      '<div class="card-face card-front" tabindex="0" role="button" aria-label="Show details for ' + esc(p.name) + '">' +
      '<div class="thumb">' + badge + stock + imgHtml + '</div>' +
      '<div class="card-body">' +
      '<span class="vendor">' + esc(p.vendor) + '</span>' +
      '<h4 class="nm">' + esc(p.name) + '</h4>' +
      '<p class="blurb">' + esc(p.blurb || "") + '</p>' +
      tagHtml +
      '<div class="meta">' + priceHtml + '<span class="unit">' + esc(p.unit && p.unit !== "from" ? p.unit : "") + '</span></div>' +
      sizeHtml +
      '<button type="button" class="card-turn" data-flip="1"><span class="ico">↻</span> Details</button>' +
      '<button type="button" class="add-cart" data-add="' + esc(p.id) + '"' + (inStock ? '' : ' disabled') + '>' +
      (inStock ? 'Add to Herbal Leaf Market Cart' : 'Sold out') + '</button>' +
      '<a class="visit" href="' + esc(p.url) + '" target="_blank" rel="noopener nofollow">or open it on ' + esc(CFG.domain || "your site") + ' ↗</a>' +
      '</div></div>' + back + '</div></article>';
  }

  function paintGrid() {
    var grid = $("grid");
    ROWS.sort(function (a, b) {
      return String(a.category || "").localeCompare(String(b.category || "")) ||
             String(a.name || "").localeCompare(String(b.name || ""));
    });
    var last = null;
    grid.innerHTML = ROWS.map(function (p) {
      var head = "";
      var cat = p.category || "Everything else";
      if (cat !== last) {
        last = cat;
        var n = ROWS.filter(function (x) { return (x.category || "Everything else") === cat; }).length;
        head = '<h3 class="cat-header"><span>' + esc(cat) + '</span><b>' + n + '</b></h3>';
      }
      return head + cardHTML(p);
    }).join("");
  }

  /* One delegated listener on the grid rather than handlers per card, because
   * paintGrid() replaces the whole grid on every variant change and anything
   * bound to a card would die with it. */
  function wireGrid() {
    var grid = $("grid");
    grid.addEventListener("click", function (e) {
      var t = e.target;
      var z = t.closest && t.closest("[data-zoom]");
      if (z) {
        e.stopPropagation();
        var pz = byId(z.getAttribute("data-zoom"));
        if (pz && pz.image) zOpenPhoto(pz.image, pz.name);
        return;
      }
      var a = t.closest && t.closest("[data-add]");
      if (a) { e.stopPropagation(); if (!a.disabled) cartAdd(a.getAttribute("data-add")); return; }
      if (t.closest && t.closest("a")) return;              // let real links through
      if (t.closest && t.closest("select")) return;         // and the size picker
      var card = t.closest && t.closest(".card");
      if (card) card.classList.toggle("on");
    });
    /* The front face is a button for assistive tech, so it has to answer the
     * keyboard the same way it answers a click. */
    grid.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var f = e.target.closest && e.target.closest(".card-front");
      if (!f) return;
      e.preventDefault();
      f.closest(".card").classList.toggle("on");
    });
    grid.addEventListener("change", function (e) {
      var s = e.target.closest && e.target.closest("[data-sel]");
      if (!s) return;
      var id = s.getAttribute("data-sel");
      SELV[id] = Number(s.value) || 0;
      var p = byId(id), v = chosen(p);
      var el = $("price-" + id);
      if (el && v) el.textContent = money(v.price);
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (zOpen) { e.preventDefault(); zClose(); return; }
    var c = $("deckCart");
    if (c && c.classList.contains("on")) { e.preventDefault(); closeCart(); }
  });

  /* ---------------- boot ---------------- */
  function sorry(msg) {
    /* Never leave an empty grid sitting there. On a page whose whole job is to
     * show somebody their own shop, a blank shelf reads as "you have nothing". */
    $("status").innerHTML = "<b>" + msg + "</b>";
  }

  function start() {
    wireGrid();
    var cb = $("deckCartBtn"), cw = $("deckCart");
    if (cb) cb.addEventListener("click", openCart);
    if (cw) cw.addEventListener("click", function (e) {
      if (e.target === cw || (e.target.closest && e.target.closest(".cart-x"))) { closeCart(); return; }
      var d = e.target.closest && e.target.closest("[data-drop]");
      if (d) cartDrop(d.getAttribute("data-drop"));
    });

    fetch("/api/deck?vendor=" + encodeURIComponent(VENDOR), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (!rows || !rows.length) {
          return sorry("We could not read your shop just now. That is our end, not yours. Reload in a moment, or tell us and we will look.");
        }
        ROWS = rows;
        paintGrid();
        var inStock = rows.filter(function (p) { return p.inStock !== false; }).length;
        $("status").innerHTML = "<b>" + rows.length + " products</b>, read from " +
          esc(CFG.domain || "your shop") + " just now, " + inStock + " of them in stock. " +
          "These are the real cards: turn one over for the description, open a photo full screen, pick a size.";
        var tally = $("tally");
        if (tally) {
          var cats = {};
          rows.forEach(function (p) { var c = p.category || "Everything else"; cats[c] = (cats[c] || 0) + 1; });
          tally.innerHTML = '<span class="pill"><b>' + inStock + '</b> in stock</span>' +
            Object.keys(cats).sort().map(function (c) {
              return '<span class="pill">' + esc(c) + ' <b>' + cats[c] + '</b></span>';
            }).join("");
          tally.hidden = false;
        }
      })
      .catch(function () {
        sorry("We could not read your shop just now. That is our end, not yours. Reload in a moment, or tell us and we will look.");
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
