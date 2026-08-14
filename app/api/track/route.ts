import { NextResponse, type NextRequest } from 'next/server'

/* /api/track — first-party event collector.
 *
 * App Router port of the plain-Node collector the two static storefronts run
 * (legal-leafmarket/api/track.js). Same contract, same payload shape, same env
 * vars, so the four sites stay one system rather than four. Behaviour changes
 * belong in all of them: fix it here and port it, or the cross-site numbers
 * quietly stop reconciling.
 *
 * The reason it exists rather than leaning on gtag alone: roughly a quarter of
 * this audience runs a content blocker and every blocklist kills
 * googletagmanager.com. A same-origin POST survives. When the browser reports
 * that gtag never loaded (ga_ok === false), we replay those events into the
 * same GA4 property server-side over the Measurement Protocol, and that
 * quarter lands in the same reports as everyone else.
 *
 * The ga_ok gate is load-bearing. Replaying unconditionally would double-count
 * every event from every visitor who is not blocking anything.
 *
 * Env, all optional. With none of it set this still 204s and still writes one
 * structured line per batch to stdout, which is the zero-configuration floor.
 *   GA_MEASUREMENT_ID   G-XXXXXXXXXX, the same id as the tag in the page
 *   GA_API_SECRET       GA4 Admin > Data Streams > Measurement Protocol secrets
 *   ANALYTICS_WEBHOOK   an Apps Script /exec that appends to a Sheet
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE = 'herbal-leaf'

// Cheap on purpose. Keeping obvious crawlers out of the engagement numbers,
// not winning an arms race with a headless browser.
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pagespeed|monitor|curl|wget|python-requests|axios|node-fetch|preview|scan/i

// Worth replaying when the client tag was blocked. web_vital and scroll_depth
// are excluded deliberately: from a blocked minority they skew the
// distributions without informing any decision, and each one is a round trip.
const REPLAY = new Set([
  'page_view', 'session_start', 'affiliate_click', 'begin_checkout',
  'add_to_cart', 'remove_from_cart', 'view_cart', 'product_view',
  'search', 'newsletter_signup', 'outbound_click', 'pwa_install',
])

const GA_NAME: Record<string, string> = {
  product_view: 'view_item',
  add_to_cart: 'add_to_cart',
  remove_from_cart: 'remove_from_cart',
  view_cart: 'view_cart',
  begin_checkout: 'begin_checkout',
  newsletter_signup: 'sign_up',
  search: 'search',
  outbound_click: 'click',
}

type Ev = { name: string; ts?: number; props?: Record<string, unknown> }
type Batch = {
  site?: string; vid?: string; sid?: string
  ga_ok?: boolean | null; ga_cid?: string | null; tz?: string
  events: Ev[]
}

const NO_CONTENT = { status: 204 }

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') || ''
  if (BOT.test(ua)) return new NextResponse(null, NO_CONTENT)

  const batch = normalise(await readJson(req))
  if (!batch.events.length) return new NextResponse(null, NO_CONTENT)

  const country = req.headers.get('x-vercel-ip-country') || ''
  const region = req.headers.get('x-vercel-ip-country-region') || ''
  const city = safeDecode(req.headers.get('x-vercel-ip-city') || '')

  const enriched = {
    site: batch.site || SITE,
    visitor: batch.vid,
    session: batch.sid,
    ga_ok: batch.ga_ok,
    tz: batch.tz,
    country, region, city,
    ua: ua.slice(0, 200),
    referer: (req.headers.get('referer') || '').slice(0, 300),
    at: new Date().toISOString(),
    events: batch.events,
  }

  // One line, one batch, JSON. Greppable in the Vercel log view and parseable
  // by a drain without anyone writing a parser for a bespoke format.
  try { console.log('analytics ' + JSON.stringify(enriched)) } catch { /* never fatal */ }

  const jobs: Promise<void>[] = []

  // ga_ok is false only when gtag was blocked, and null when the site has no
  // GA4 id at all, so the strict comparison is the whole gate.
  if (batch.ga_ok === false && process.env.GA_MEASUREMENT_ID && process.env.GA_API_SECRET) {
    jobs.push(sendToGa4(batch, country, region))
  }
  if (process.env.ANALYTICS_WEBHOOK) jobs.push(post(process.env.ANALYTICS_WEBHOOK, enriched))

  // Bounded: a hung webhook must not hold the invocation open, and on a
  // fire-and-forget sink a timeout is not an error worth reporting.
  if (jobs.length) {
    try { await Promise.race([Promise.allSettled(jobs), sleep(2500)]) } catch { /* swallow */ }
  }

  return new NextResponse(null, NO_CONTENT)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: 'POST' } })
}

/* GA4 Measurement Protocol. Two details that are easy to get wrong and leave
 * you with a property full of "(not set)" and zero engaged sessions:
 *   - session_id must ride on EVERY event or GA4 cannot stitch them and each
 *     one becomes its own session
 *   - engagement_time_msec must be present or the session is never counted as
 *     engaged, which zeroes the engagement rate for exactly the cohort this
 *     path exists to recover
 */
async function sendToGa4(batch: Batch, country: string, region: string) {
  const url = 'https://www.google-analytics.com/mp/collect'
    + '?measurement_id=' + encodeURIComponent(process.env.GA_MEASUREMENT_ID as string)
    + '&api_secret=' + encodeURIComponent(process.env.GA_API_SECRET as string)

  const events = batch.events
    .filter((e) => REPLAY.has(e.name))
    .slice(0, 25) // Measurement Protocol hard-caps a request at 25 events
    .map((e) => {
      const p: Record<string, unknown> = { ...(e.props || {}) }
      delete p.visitor_id // carried as client_id instead
      if (e.name === 'search' && p.query) { p.search_term = p.query; delete p.query }
      return {
        name: GA_NAME[e.name] || e.name,
        params: {
          ...trim(p),
          session_id: batch.sid,
          engagement_time_msec: 1,
          // Geo is the one thing this path cannot recover: the Measurement
          // Protocol attributes location to the caller, which here is a Vercel
          // region and not the shopper. Sent as plain params so the data is at
          // least present in Explorations, rather than letting GA4 report every
          // blocked visitor as being wherever the function happened to run.
          edge_country: country || undefined,
          edge_region: region || undefined,
          blocked_client: true,
        },
      }
    })

  if (!events.length) return

  await post(url, {
    // Prefer gtag's own id when the cookie survived, so a visitor who blocks
    // the script on some visits and not others stays a single user.
    client_id: batch.ga_cid || batch.vid || String(Date.now()),
    timestamp_micros: Date.now() * 1000,
    non_personalized_ads: true,
    events,
  })
}

function normalise(body: any): Batch {
  if (!body || typeof body !== 'object') return { events: [] }

  if (Array.isArray(body.events)) {
    return {
      site: body.site, vid: body.vid, sid: body.sid,
      ga_ok: body.ga_ok, ga_cid: body.ga_cid, tz: body.tz,
      events: body.events.filter((e: Ev) => e && e.name).slice(0, 50),
    }
  }

  // Legacy single-event shape. A stale cached page can still be posting it
  // hours after a deploy, so accepting it costs one branch and avoids a gap in
  // the data every time something ships.
  const name = body.name || body.event
  if (!name) return { events: [] }
  return {
    site: body.site, vid: body.vid, sid: body.sid, ga_ok: body.ga_ok,
    events: [{ name: String(name), ts: Date.now(), props: body.props || body }],
  }
}

// GA4 rejects a param over 100 chars and ignores objects. Truncating here
// rather than letting the API drop the whole event keeps a long product name
// from costing us the conversion it was attached to.
function trim(props: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === '') continue
    if (typeof v === 'object') continue
    out[String(k).slice(0, 40)] =
      typeof v === 'number' || typeof v === 'boolean' ? v : String(v).slice(0, 100)
  }
  return out
}

async function readJson(req: NextRequest) {
  try { return await req.json() } catch { return {} }
}

async function post(url: string, body: unknown) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch { /* analytics must never surface an error to the page */ }
}

function safeDecode(s: string) { try { return decodeURIComponent(s) } catch { return s } }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }
