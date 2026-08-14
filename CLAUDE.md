# CLAUDE.md - Operating guide for Herbal Leaf Market

Read this fully before editing. Sister project to **Legal-Leaf Market** and
**Nicotia Market**. The repo looks like a Next.js app, and the API genuinely is
one, but the entire storefront is legacy static files. Editing the wrong layer,
or the right layer with the wrong tool (see the line-endings trap in section 4),
turns a one-line change into a broken deploy.

---

## 1. What this is

The affiliate storefront for `herballeafmarket.com`: CBD, CBG, herbal smokes,
tea and botanicals from seven independent makers. We never take an order; the
cart is an estimate and checkout is a handoff to each maker's own site with our
affiliate attribution and coupon attached.

**Two very different halves live in one repo:**

- **The storefront is static.** Everything a visitor sees is plain HTML/JS in
  `public/`, served as-is. `index.html` (~83KB, 797 lines) is the whole shop
  page; `app.js` is the engine. There is no React on the storefront, no build
  step for it, and no JSX to edit. Front-end changes are plain file edits.
- **The API is Next.js 16 / React 19 / TypeScript** route handlers under
  `app/api/`, on Vercel, with Drizzle + `@neondatabase/serverless` (Neon
  Postgres) standing in for the original Cloudflare Worker's KV and D1.
  `lib/hlm.ts` is a faithful port of that Worker and holds nearly all server
  logic.

```
vercel.json            Cron schedules only (3 crons, section 6)
package.json           Next 16, React 19, Drizzle; pnpm
lib/
  hlm.ts               THE server file: vendor registry, scraper, COA join, RPC map
  kv.ts                Cloudflare-KV-shaped wrapper over the Postgres kv table
  db/schema.ts         members, clicks, kv tables (D1 shapes preserved)
app/api/
  health, inventory, nss-ids, rpc, unsub    route handlers
  cron/click-report, cron/digest, cron/refresh-inventory
public/
  index.html           The shop. Age gate, admin-free, loads app.js
  app.js               Engine: facets, cart, Garden, ritual builder, checkout
  products.js          SEED inventory (fallback when /api is unreachable)
  hlm-api.js           Shim recreating google.script.run over POST /api/rpc
  knowledge.js         Botanical evidence matrix grounding "Build Your Ritual"
  focus.js             ?focus= deep-link scroll (event-driven, not observer)
  sw.js                Service worker (section 7)
  know-the-facts.html  Content page (2018 Farm Bill / 2026 hemp ban)  [MIXED EOL]
  anecdote-library.html Content page (reader stories)                 [MIXED EOL]
  facts.html stories.html   meta-refresh redirect stubs to the two above
  admin.html           Owner console (noindex; talks to /api/rpc with ADMIN_PW)
  icon.svg + 9 raster icons + 3 og-*.png   ALL generated, section 10
scripts/
  branding.py          Regenerates every icon + share card from icon.svg
  sn_coa_audit.py      Reference implementation of the Secret Nature COA join
  vendor_probe.py      product_type histogram for a candidate feed (section 5)
```

---

## 2. Deploy model, and the two repos that look alike

```
edit -> push to main on Legal-Leaf-Market/HerbalLeafMarketClaudeLive
     -> Vercel project "herbal-leaf" auto-deploys herballeafmarket.com
```

Verified end to end. Two standing hazards:

- **Two writers, one repo.** A v0.dev chat also owns the Vercel project and can
  push its own branches and PRs to this same repo. Always `git pull` (and check
  `gh pr list`) before you push; a force-push or a stale base here overwrites
  someone else's work, not just yours.
- **The decoy.** `Legal-Leaf-Market/HerbalLeafMarket-CloudflarePort-ARCHIVED`
  (formerly `HerbalLeafMarketLive`) is an archived Cloudflare Workers port that
  deploys NOWHERE. It has been renamed and archived so it bites less, but if a
  clone of it ever reappears locally (it used to sit at `..\herbal-leafmarket`),
  do not work in it. Fastest tell: it has no `app/api/` directory; its content
  is a `herbal-leaf-market-cloudflare` folder.

---

## 3. Toolchain on this box

There is **no node, npm, npx or vercel CLI** on this Windows machine, and the
storefront doesn't need them. `gh` IS installed and authed.

Verify front-end changes with `py -3 -m http.server` serving `public/`, then a
browser. Locally every `/api/*` call 404s; that is expected and useful, because
the page then falls back to the seed catalogue in `products.js`, which is
exactly the offline path you also want exercised. What you can check locally:
grid renders, cards, facets, cart math, console clean. What you cannot: live
inventory, COA links, RPC. Those you check on the deployed site (section 13).

---

## 4. LINE ENDINGS TRAP: run `git ls-files --eol` before touching any HTML

`core.autocrlf=true` and there is **no `.gitattributes`**. Most files are
`i/lf` and round-trip fine. But two are `i/mixed`:

- `public/know-the-facts.html`
- `public/anecdote-library.html`

Git refuses to normalize mixed-eol files, so any editor that rewrites the whole
file (which is most of them, including a naive scripted rewrite) flips every
line ending and turns a one-attribute change into a 300-line diff. The fix that
works: **patch mixed files at byte level through ISO-8859-1**. In PowerShell
that is `[Text.Encoding]::GetEncoding(28591)` (`::Latin1` is null on PS 5.1);
read bytes, replace the exact substring, write bytes. Never re-serialize.

Related: a literal NUL byte anywhere in a text file makes git classify it as
binary (`-text` in `git ls-files --eol`) and silently disables eol handling.
If a diffstat looks far too big for the change you made, check
`git ls-files --eol` on the touched files and sweep for `\x00` before anything
else. This family of bug survives review because the diff still looks like text.

---

## 5. Vendors: one vendor, FOUR registrations, or the storefront lies

Adding or changing a Shopify vendor touches four places, and all four ship
together or a shopper gets told something false:

1. **`SHOPIFY_STORES` in `lib/hlm.ts`.** The feed. Prefer an `include`
   allow-list of `product_type`s: a new type the vendor invents later stays OUT
   until reviewed, instead of silently appearing on the shelf. Use
   `categoryMap` to rename their taxonomy into ours at ingest (a SHOUTING
   "LOOSE LEAF" becomes "Tea", or it renders as an all-caps chip that sorts
   last, since `catRank()` matches `CATEGORY_ORDER` exactly).
2. **`SHIPPING` in `public/app.js`.** Three states: a verified
   `{flat, freeOver}`, an honest `{unknown:true}`, or absent. Absent and
   unknown both resolve to unknown, which renders as "shown at the maker's
   checkout" and keeps that vendor out of the out-the-door figure. Before
   2026-08-12 a missing vendor resolved to FREE, so forgetting one did not
   fail loudly, it promised postage the maker never offered. One flat rate per
   vendor is all this map can express, so a maker whose lines ship at different
   rates needs the pricier ones kept out of the feed.
3. **`BRAND_AFFILIATES` in `app.js` AND `HLM_DEFAULT_RULES.coupons` in
   `lib/hlm.ts`.** Attribution and the advertised discount. `percent:0`
   keeps `getCoupon()` from advertising a code that does not exist.
4. **`SHOPIFY_VENDORS` in `app.js`.** The checkout route. A Shopify vendor
   missing here falls into the non-Shopify branch and "checkout" opens the
   maker's bare homepage with an empty cart. Nothing complains, which is why
   this one gets forgotten.

**`pending: true` is the honest halfway house.** A maker registered in 2, 3 and
4 but whose feed nobody has read yet goes into `SHOPIFY_STORES` with `pending`
set; `buildInventory` skips it and logs which vendors it held back. Run
`py -3 scripts/vendor_probe.py <domain>` to print the real `product_type`
histogram, write the `include`/`categoryMap` from what is actually there, read
the shipping rate off the maker's own checkout, then delete the flag. Guessing
instead fails in both directions: no `include` fills the shelf with teaware and
gift cards, a guessed one matches nothing and reads as a maker who sells
nothing.

Shopify's `products.json` caps at 250 rows per page and truncates silently.
`fetchStoreProducts` pages until a short page comes back, with a 4-page runaway
guard that logs if it ever trips (a 289-product vendor found this bug).

After any vendor change, the 6h KV cache (`hlm_live_v5`) still holds the old
catalogue. Bust it: `POST /api/rpc {"fn":"refreshInventory","args":["<ADMIN_PW>"]}`,
or wait for the 4h cron. If you changed the payload's SHAPE, bump
`INVENTORY_KEY`'s version in the same commit. That means REMOVING a vendor too,
not just adding one: a warm key goes on serving a dropped maker's products onto
a shelf whose `app.js` no longer knows their shipping, checkout or coupon. A
warm cache once hid the Secret Nature COA join on production for hours while
the code sat correct.

---

## 6. API surface, RPC gating, crons

`/api/rpc` is unauthenticated with `Access-Control-Allow-Origin: *`, so the RPC
map in `lib/hlm.ts` is split on purpose: the public `RPC` map is only what the
storefront actually calls, plus three admin functions that verify the password
themselves. Everything with side effects or private data (`refreshInventory`,
`hlmSendWeeklyDigest`, click stats, etc.) lives in `ADMIN_RPC`, where the FIRST
argument must be `ADMIN_PW` and `checkAdmin()` fails closed when the var is
unset. Before this split, any page on the internet could email the member list.

The three crons (`vercel.json`): `click-report` Mon 12:00 UTC, `digest` Mon
13:00 UTC, `refresh-inventory` every 4h. All three **fail closed on
`CRON_SECRET`**: unset returns 503, wrong bearer returns 401. The 4h refresh
inside the 6h TTL means the inventory key never expires in normal operation and
no visitor ever pays for the multi-store scrape; the TTL is the safety net for a
dead cron, not the schedule. The rebuild overwrites, never delete-then-rebuild.

`/api/inventory?debug` returns `{count, coas, byVendor}` with per-vendor
`{total, inStock, coas}`. It is the first stop whenever the catalogue looks
wrong: one request answers "is it the data or the page?".

---

## 7. Service worker (`public/sw.js`)

Pages are **network-first with cache fallback**. This is a scar, not a
preference: "/" was once precached under a cache-first rule and visitors sat on
a days-old storefront while the deployed site had moved on. When the owner
reports "old version" or "wrong CSS", suspect the SW first; verify what origin
served with a cache-busting query (the nav's `?v=2` links exist for this) and
read the `Age:` header for CDN copy age.

- **Never cache `/api/*`.** The site promises live pricing; a cached inventory
  makes that a lie. Cross-origin and `?unsub` are also passed through untouched.
- JS/CSS/icons are cache-first with background refresh, so they run
  **one load behind**: the first check after an `app.js` deploy sees the OLD
  file. Reload once before concluding a deploy failed.
- Bump the `CACHE` name (`hlm-v3`) on any strategy change; activate deletes
  every cache that doesn't match, so the bump is the eviction.

---

## 8. Affiliates: real money, easily polluted

Two networks. `AWIN_PUBLISHER_ID = "3004653"` is live; `IMPACT_PUBLISHER_ID` is
blank until the impact.com publisher account is issued. Per vendor (all in
`BRAND_AFFILIATES`):

- **Puff Herbals**: Awin, `awinmid: 74076`.
- **Bear Blend**: `?ref=JAC6375`, verified to set a 30-day `affiliate_code`
  cookie, server-validated on their end.
- **Natural Smoke Shop**: `?tr=138`, attribution UNCONFIRMED; treat reports from
  it as soft until proven.
- **Secret Nature, Soul CBD**: `awinmid` empty, Awin applications pending;
  links go direct until approval.
- **Charlotte's Web**: registered on BOTH networks, Awin pending and impact.com
  pending (programme 44451, Creator, 10%). An existing vendor whose handoff has
  never been attributed, which makes it the cheapest revenue on the list. The
  two registrations do not cancel each other: `withAffiliate()` tries impact
  first and falls through to Awin, so whichever approval lands first starts
  crediting.
- **Tea For Guys, Purest Mushrooms, Wooden Spoon Herbs, Balls Deep Tea Company,
  St. Francis Herb Farm, Republic of Tea, Tea Sparrow, Encha Matcha, RE
  Botanicals**: registered 2026-08-12, all impact.com, all PENDING, all linking
  direct. Rishi Tea was dropped the same day. Encha and RE Botanicals are the
  best-paying of the nine at 25%.

**Two of the nine are NOT Shopify.** St. Francis Herb Farm and RE Botanicals
run WordPress (their paths are `/shop/` and `/about/` with trailing slashes,
not `/collections/` and `/products/`), so they have no `products.json`, no row
in `SHOPIFY_STORES` and no place in `SHOPIFY_VENDORS`. Ingesting either needs a
scraper of the shape `getSmokingBlendsIds()` uses for Natural Smoke Shop.
Checking the URL shape before writing a store entry is worth the ten seconds:
the registry cannot tell you, and a Shopify `/cart/` permalink on a WooCommerce
site 404s rather than filling.

**RE Botanicals collides with the organic-copy rule (section 11).** Their whole
brand is a USDA certified-organic claim, so their product titles carry it, and
their feed would put those titles on cards. Section 11's only carve-out is for
the maker's own URLs, not the maker's own product names. Settle which side an
ingested title falls on BEFORE clearing their pending flag, not after it ships.

**`IMPACT_PROGRAMS` in `lib/hlm.ts` says which programme to apply to**, with the
id, payout label and rate from the marketplace export. It is server-side on
purpose: none of it builds a link, and the storefront should not ship a table of
our commission rates to every visitor. Two rules live there because both cost
real money:

- **Take the Creator programme.** Where an advertiser runs both, Creator often
  pays more for identical traffic: Wooden Spoon Herbs is 5% standard against
  20% Creator. Search the export by domain and take the best-paying row, not
  the first match.
- **Read `payoutLabel`, not just the rate.** `Recurring Sales` pays on repeat
  orders, `Online Sale` pays once. Tea For Guys runs both at 15%, which is not
  the coin toss it looks like: tea is rebought, so 40494 (recurring) is worth
  more per customer than 44574 (a one-shot content placement).

An approval supplies a tracked link and a commission. It does NOT supply a
feed, which is why an approved maker can still sit `pending` in
`SHOPIFY_STORES` until someone reads their catalogue (section 5).

**impact.com links are shaped nothing like Awin's.** Awin hangs one merchant id
off a shared gateway, so a wrong `awinmid` still lands the shopper on the shop.
impact.com issues a per-advertiser host plus a campaign and an ad id, resolved
as a unit: `https://<host>/c/<publisherId>/<campaignId>/<adId>?u=<destination>`.
A link built from an invented campaign or ad id does not degrade, it dies at the
network and the shopper never arrives. So `impactUrl()` demands all four parts
plus an `http(s)` destination and returns "" otherwise, and `withAffiliate()`
falls through to the direct link. Filling in `host`/`campaign`/`ad` for one
maker is the whole of switching that maker live.

**Never GET an `awin1.com/cread.php` or `*.pxf.io/c/...` link while testing.**
Every GET registers a real click and pollutes the owner's conversion stats with
our own traffic. Inspect the URL string; do not follow it.

**Coupons are verified at the till, not assumed** (tested 2026-08-08 at each
maker's own checkout): `JACOBKENNEDY` is live ONLY at Natural Smoke Shop.
Bear Blend, Puff Herbals, Secret Nature and Soul CBD all reject it, so their
`BRAND_AFFILIATES` entries are `percent:0` and the cards advertise nothing.
Bear Blend's `JAC6375` is an affiliate code their cart accepts
(`type:"affiliate"`) but it does not move the total; the desktop bookmarklet
applies it for attribution. Before advertising any coupon, load the maker's
cart permalink and apply the code at the real checkout: Shopify silently drops
invalid `?discount=` codes, so only the checkout's own "valid/invalid" verdict
counts. A struck-through price the checkout refuses to honour is the worst bug
this storefront can ship.

---

## 9. Secret Nature COA join

Their feed and product pages carry zero COA links, but the footer page
`/pages/laboratory-test-results` hosts ~93 per-strain PDFs. `lib/hlm.ts` joins
them to products on the identity **(strain key, form, cannabinoid)**, and every
leg of that identity is a bug that actually happened: empty keys matched
unrelated files, a gummy nearly linked a flower cert, newest-first alone handed
BloodDiamondCBD the BloodDiamondTHCA.pdf. Conservative on purpose: a wrong
certificate on a card is far worse than a missing link, prefer under-matching.
Measured 2026-08-08: 90 of 207 products matched, hand-audited.

**`scripts/sn_coa_audit.py` is the reference implementation** and must stay
line-for-line in sync with `hlm.ts` (stop-list, regexes, tiebreak). It prints
every join it would make; run it whenever Secret Nature adds strains, so a bad
join is caught by eye before it reaches a card.

---

## 10. Storefront conventions

- **Facets are SINGLE-select and bidirectionally coupled.** Category and store
  each constrain the other via `pool(ignore)`: a facet's list is counted
  against the pool with the OTHER facet applied but not itself, so no visible
  choice can land on an empty grid. Zero-count options are REMOVED, not greyed.
  My Garden is a mode, not a category.
- **`isTea()` is a cross-cutting view, not a category.** `TEA_VENDORS` is the
  wholesale shortcut for makers whose entire ingested catalogue is steepable;
  NSS counts only its steepable lines; anyone else, whatever ingest labelled
  "Tea". It was once hard-wired to NSS, which excluded an actual tea company
  from the tea filter. Never wire it to one vendor again. `TEA_VENDORS` is
  currently empty and a maker only earns a place in it once somebody has read
  their feed: "Tea" in the company name is not evidence, since most tea
  companies also sell pots, tins and gift sets.
- **The lily-of-the-valley bell has ONE geometry** (cup + flared skirt), reused
  at five scales in `#lilyIcon`, in `#sprigIcon`, and in `icon.svg`. The skirt
  carries the cup's fill and must stay an OPEN path: SVG closes it implicitly
  for filling, and adding `Z` strokes a chord across the bell. It must never be
  `fill="none"`.
- **Every raster brand asset is generated.** `py -3 scripts/branding.py`
  rebuilds the 9-icon set and the three og share cards from `public/icon.svg`.
  Edit the SVG, run it, commit what changed; never hand-edit a PNG.
- **Checkout gate:** only checkout routes through `requireLoginThen`; the skip
  is `sessionStorage["hlm_gate_skip"]`, session-scoped on purpose ("not this
  visit" must not become "never ask"). Garden saves were never gated. PENDING
  callbacks fire synchronously inside the click gesture or `window.open` gets
  popup-blocked.
- **The header live pill is earned, not asserted:** `setLivePill` turns green
  only in the branch where live rows actually merged, and says "Sample prices"
  otherwise. Bear Blend and NSS are seed-served even on a green pill.
- PWA install: deferred `beforeinstallprompt` behind the `#pwaInstall` button,
  iOS gets a toast. 21+ age gate on `index.html`.

---

## 11. Copy rules

- **"certified-organic" is removed from all claims (2026-08-08) and must not
  come back.** The only survivors are NSS product-URL slugs in `products.js`,
  which are their URLs, not our words. `branding.py` enforces the same rule on
  card text.
- **No em dashes anywhere in copy.** House rule across all four sites; use a
  comma, colon, or parentheses instead.

## 12. Environment variables (Vercel project settings)

| Var | Gates |
|---|---|
| `ADMIN_PW` | `checkAdmin()`: all `ADMIN_RPC` functions, rules/matrix saves, `admin.html`. Fails closed when unset. |
| `CRON_SECRET` | All three crons. Unset = 503, wrong = 401. Load-bearing: without it inventory refresh, digest and click report all refuse to run. |
| `DATABASE_URL` | Neon Postgres (members, clicks, kv). The whole API needs it. |
| `RESEND_API_KEY` | All outbound email; `send()` logs and skips without it. |
| `SITE_FROM_EMAIL` | From address or bare domain; normalised in `send()`. |
| `REPORT_EMAIL` | Click-report recipient; falls back to `hello@herballeafmarket.com`. |
| `PUBLIC_URL` | Unsubscribe-link base in emails; falls back to the site URL. |

## 13. Verify before you merge

1. `git ls-files --eol` on any HTML you touched; a `w/` change or `-text` you
   did not intend means stop (section 4).
2. `git diff --stat` proportional to the change. A 300-line diff for a
   one-attribute edit is the eol trap, not your edit.
3. `py -3 -m http.server` over `public/`: grid renders from seed, cards, cart
   math, facets, no console errors.
4. After deploy: hit `/api/inventory?debug` (counts and coas sane), then load
   the site and **reload twice** before judging JS changes (SW is one load
   behind, section 7).

## 14. Hard "do not" list

- Do NOT work in the archived Cloudflare decoy repo (section 2).
- Do NOT push without pulling first; v0.dev also writes to this repo.
- Do NOT rewrite `know-the-facts.html` or `anecdote-library.html` with a normal
  editor save; byte-patch through ISO-8859-1 (section 4).
- Do NOT add a vendor without all four registrations (section 5).
- Do NOT clear a store's `pending` flag without running `vendor_probe.py` and
  writing the `include` list from what the feed actually holds (section 5).
- Do NOT put a guessed number in `SHIPPING`; `{unknown:true}` is the honest
  entry until a rate has been read at the maker's own checkout.
- Do NOT cache `/api/*` in the service worker, ever.
- Do NOT broaden `isExcluded`/`EXCLUDE_PATTERN`-style filters without checking
  live product names first; a broad regex silently hides real inventory.
- Do NOT reintroduce "certified-organic" or any organic claim in copy.
- Do NOT GET-request an awin1.com or *.pxf.io tracking link in testing
  (section 8).
- Do NOT let `sn_coa_audit.py` and the `hlm.ts` matcher drift apart.
- Do NOT trust the first post-deploy page check; the SW serves JS one load behind.
