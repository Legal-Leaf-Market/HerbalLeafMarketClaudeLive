# Analytics

One tracking layer, four storefronts, one event taxonomy. This file is
identical in all four repos. The code it describes lives in:

| What | Legal-Leaf / Nicotia / Herbal-Leaf | KawaiiKatz |
|---|---|---|
| Client | `public/js/analytics.js` | `public/analytics.js` |
| Tag | `<script>` before `</head>` on every page | `<Script>` in `app/layout.tsx` |
| Collector | `api/track.js` | `app/api/track/route.ts` |
| Owned sink | `legal-leafmarket/APPS_SCRIPT_ANALYTICS.gs` (one copy serves all four) | ditto |

`analytics.js` is **byte-identical across the four repos**. Fix it in
`legal-leafmarket/public/js/analytics.js` and copy it out. Do not fork it.

---

## Why this is not Vercel Web Analytics

Because Vercel cannot carry it. From their own pricing table
(`vercel.com/docs/analytics/limits-and-pricing`, current as of 2026-06-26):

| | Hobby | Pro | Pro + Analytics Plus |
|---|---|---|---|
| Custom events | **not available** | included | included |
| Properties per custom event | – | **2** | 8 |
| Reporting window | **1 month** | 12 months | 24 months |
| UTM parameters | – | – | included |
| Events | 50k/mo, then collection pauses 7 days | $0.03 per 1k | $0.03 per 1k |

Three consequences that decided the design:

1. On Hobby, every `va("event", …)` call is discarded. Legal-Leaf had about
   twenty of them (`add_to_cart`, `outbound_click`, `filter_used`,
   `store_logo_filter`) and none of that data exists.
2. Even on Pro, an `affiliate_click` would be truncated to two properties. The
   event needs store, product, price, position and path to be worth recording.
3. A 1-month window means Legal-Leaf's history rolls off before it can show a
   month-over-month trend, which is the main thing a year-old site wants.

Vercel Web Analytics is still enabled and still useful. It is the free,
automatic, cookieless page-view baseline, and nothing here touches it.

---

## The three sinks

A single `track()` call fans out. Sinks are independent: adding or removing one
never touches a call site.

**1. GA4 (`gtag`)** the reporting brain. 10M events/month free, 25 parameters
per event, 14-month retention, funnel and path exploration, free BigQuery
export. Loads only when `GA_ID` is set, so with no id there is no third-party
request and no cookie.

**2. First-party collector (`POST /api/track`)** the ad-block story. Roughly a
quarter of a cannabis, hemp or nicotine audience runs a content blocker, and
every mainstream blocklist kills `googletagmanager.com`. A same-origin POST
survives. When the browser reports that gtag never loaded, the collector
replays those events into the same GA4 property server-side over the
Measurement Protocol, so the blocked quarter lands in the same reports.

The gate for that replay is the `ga_ok` flag in the payload. Without it, every
event from every visitor who is *not* blocking would be counted twice.

**3. Vercel (`va`)** off by default, see the table above. Set
`data-vercel="1"` on the tag if the team ever moves to Pro; only the three
money events are sent, with the two properties that survive the cap chosen
deliberately rather than left to chance.

---

## What is tracked

Everything below fires with **no call site**. A new page, a new grid or a
v0-regenerated component starts reporting the moment the tag is on it.

### Acquisition and session
| Event | Fires | Notable props |
|---|---|---|
| `session_start` | first event of a 30-minute window | `entry` |
| `page_view` | load, and on `pushState` / `replaceState` / `popstate` | `path`, `title`, `nav` |
| `engaged_time` | tab hidden or page unload | `seconds`, `max_scroll` |
| `scroll_depth` | 25 / 50 / 75 / 90 % | `percent` |

Every event also carries `utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`, `utm_term`, `referrer_host`, `landing_path`, `click_id`
(google/meta) and `ref_code`, captured once per session and then carried on
every later event so attribution survives the click off the landing page.
Plus `site`, `path`, `device`, `pwa`, `session_id`, `visitor_id`.

### Money
| Event | Fires | Notable props |
|---|---|---|
| `affiliate_click` | outbound click to any non-family, non-social host | `store`, `product`, `price`, `href`, `position` |
| `begin_checkout` | `.checkout` / `.cocheckout` / `#ggDoCheckout` | `store`, `cart_value` |
| `add_to_cart`, `remove_from_cart`, `view_cart` | cart operations | `product`, `store`, `price`, `qty` |
| `product_view` | card, modal or flip opened | `product`, `store`, `price`, `category` |
| `outbound_click` | any cross-origin link | `href`, `host`, `text` |
| `sister_site_click` | link to another site in the family | `host` |

`store` comes from a `data-store` attribute when present and falls back to the
hostname, so a vendor added to the catalogue tomorrow reports correctly today
with no config change.

### Behaviour
| Event | Fires |
|---|---|
| `search` | debounced, on any `input[type=search]`, `#q`, `#search`, `[data-search]`. Carries `results` count |
| `filter_used` | any select / checkbox / radio / range change. Carries `filter`, `value` |
| `newsletter_signup` | submit of a form containing an `input[type=email]` |
| `form_submit` | any other form submit |
| `rage_click` | 3 clicks inside 30px and 700ms, which on a catalogue almost always means a card that looks tappable and is not |
| `pwa_install`, `pwa_prompt_shown` | home-screen install. These sites cannot be in either app store, so PWA share is a real KPI |

### Health
| Event | Fires |
|---|---|
| `js_error` | `window.onerror` and unhandled rejections, capped at 5 per page |
| `web_vital` | LCP, CLS, INP, TTFB with Google's good / needs-improvement / poor rating |

A blank grid caused by one thrown exception looks identical to a quiet day in a
traffic report. That is what `js_error` is for.

### Also
The last 250 events are kept in `localStorage.sa_events`, which is the only way
to debug a shopper's session from their own browser when neither GA4 nor the
collector is reachable.

---

## Turning it on

Right now the layer is **live and inert**: it collects, batches and POSTs to
`/api/track`, and the collector writes one structured JSON line per batch to
stdout, which lands in Vercel's runtime logs. Nothing else is configured, and
nothing needs to be for the site to work.

There are two ways to get a dashboard. They are not exclusive and the fan-out
means running both costs nothing extra.

### Path A: GA4 (recommended)

One property for all four sites, not four. The hostname dimension separates
them in every report anyway, so nothing is lost, and one property buys two
things four cannot: one dashboard instead of four, and visibility of the
shopper who crosses from Nicotia to Legal-Leaf through the sister-site links in
the footers. Those journeys are the whole argument for running the family as a
family, and four properties make them invisible.

1. `analytics.google.com` > Admin > Create property. Add a Web data stream for
   `legal-leafmarket.com`. Copy the `G-XXXXXXXXXX` measurement id.
2. Paste it into `GA_ID` at the top of
   `legal-leafmarket/public/js/analytics.js`, then copy that file to the other
   three repos. **One constant, four copies.**
3. Optional, for the ad-block recovery path: in the same data stream, open
   Measurement Protocol API secrets and create one. Set on each Vercel project:
   ```
   GA_MEASUREMENT_ID = G-XXXXXXXXXX
   GA_API_SECRET     = <the secret>
   ```
   Without these two the site still works and GA4 still reports; you are only
   giving up the blocked quarter.

Geo is the one thing the recovery path cannot restore: the Measurement Protocol
attributes location to the caller, which is a Vercel region and not the
shopper. Those events carry `edge_country` and `edge_region` params instead, so
the data is present in Explorations rather than silently wrong.

### Path B: your own copy in a Google Sheet

`APPS_SCRIPT_ANALYTICS.gs` has its own setup notes at the top. Deploy it as a
Web App and set `ANALYTICS_WEBHOOK` to the `/exec` URL on each Vercel project.
Every event batch is appended to a Sheet you own outright: no sampling, no
reporting window, no vendor who can change the rules. Looker Studio connects to
Sheets natively and free, which is the dashboard.

This is the answer to "what if the GA4 account goes sideways". GA4 is the good
dashboard; this is the copy that cannot be taken away.

---

## Notes for whoever edits this next

- **`GA_ID` lives in one constant**, not on fifty script tags. Changing it is a
  one-line edit copied to four repos.
- **The site key is derived from the hostname**, with `data-site` only as an
  override. `next/script` rebuilds the element rather than emitting the JSX
  verbatim, and a page copied between repos arrives with the wrong attribute.
  The hostname cannot be wrong.
- **Legal-Leaf's pages still carry their old inline tracker.** It could not be
  removed without editing the file that holds the base64 engine (see
  `CLAUDE.md` section 5). Instead `LL.track` is defined as an accessor with a
  no-op setter, so the page's later re-assignment is ignored rather than
  clobbering us. It has to be an accessor and not a non-writable data property:
  those page scripts are `"use strict"`, where assigning to a non-writable
  property throws and would take the whole catalogue down.
- **A 400ms signature window de-dupes** the resulting double-fires, and any
  future one.
- **One ordered finalizer** runs on `pagehide`, rather than each feature adding
  its own listener. Listeners fire in registration order, so a late-registered
  one enqueues after the final flush has already emptied the queue and is lost
  on every single page view. Web vitals hit exactly this and now register on
  the finalizer.
- **Herbal Leaf's service worker is cache-first for JS**, so an edit to
  `analytics.js` there reaches a returning visitor one load late. Legal-Leaf
  and Nicotia are network-first for `.js` and do not have this.
- **Admin surfaces are excluded** (`admin.html`), so an afternoon of poking at
  the catalogue does not dominate the site's engagement numbers.
- The tag was inserted into all 35 static pages **byte-transparently**, through
  ISO-8859-1, so the base64 engine line, the CRLF endings and the non-ASCII
  inventory of `index.html` are provably untouched. Do it the same way.
