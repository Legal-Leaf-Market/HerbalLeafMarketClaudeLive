import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { siteEvents } from "@/lib/db/schema"

/* =========================================================================
 * THE EVENT SINK. Public, unauthenticated, and it always answers 204.
 *
 * ALWAYS 204, EVEN WHEN IT FAILS
 *
 * Nothing a shopper does should get worse because analytics broke. A 500
 * here shows up in the console of somebody who did nothing wrong, and on a
 * beacon sent while the page is closing it is a retry we do not want. So a
 * database outage silently drops events, the same way the storefront falls
 * back to `products.js` rather than showing an error when /api is down.
 *
 * The cost of that is real and worth naming: if Neon is down for an hour,
 * that hour is missing from the dashboard with nothing to mark it. Read a
 * sudden flat spot as a possible outage before reading it as a quiet day.
 *
 * AN OPEN ENDPOINT THAT WRITES ROWS
 *
 * Anyone can POST here, so everything is clamped: a cap on events per
 * request, a cap on every string, and an ALLOW-LIST on the name. Without the
 * allow-list a script could fill the table with invented names and the admin
 * page would render them as though they were real features of the shop.
 *
 * Deliberately NOT rate limited by IP. Rate limiting by IP means holding an
 * IP, and the entire point of this table (see lib/db/schema.ts) is that it
 * holds nothing identifying. A padded table is a cheaper problem than a log
 * of who visited, and the retention sweep clears it either way.
 * ====================================================================== */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_EVENTS = 40
const MAX_LEN = 200
/** Long enough to read a season, short enough to stay bounded. */
const RETAIN_DAYS = 120

/* Names the admin page knows how to read. Anything else is dropped.
 * Must stay in step with the emitter in public/events.js: an event the
 * emitter sends and this list does not carry is silently lost, which is the
 * one failure here that looks exactly like "nobody did that". */
const ALLOWED = new Set([
  // where people are
  "page_view", "product_view", "maker_view",
  // interest, in ascending order of intent
  "card_open", "garden_add", "cart_add", "coupon_copy",
  /** The money event: the last thing we see before a maker takes over. */
  "outbound_click",
  // the basket
  "cart_open", "checkout_click",
  // the ritual builder
  "ritual_open", "ritual_goal", "ritual_result", "ritual_zero", "ritual_click",
  // finding things
  "search", "search_zero", "search_click", "facet_change",
  // the Garden
  "garden_open", "garden_save", "signup_start", "signup_done",
])

function ok() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}

function str(v: unknown, max = MAX_LEN): string {
  if (typeof v !== "string") return ""
  return v.trim().slice(0, max)
}

/* CREATE TABLE on first write rather than a migration step, matching how the
 * kv table is handled: this project has no migration runner and a route that
 * cannot create what it needs fails silently forever on a fresh database. */
let ensured: Promise<void> | null = null
function ensureTable(): Promise<void> {
  ensured ??= db
    .execute(
      sql`CREATE TABLE IF NOT EXISTS site_events (
        id text PRIMARY KEY,
        ts bigint NOT NULL DEFAULT 0,
        sid text NOT NULL DEFAULT '',
        name text NOT NULL DEFAULT '',
        page text NOT NULL DEFAULT '',
        product text NOT NULL DEFAULT '',
        vendor text NOT NULL DEFAULT '',
        cat text NOT NULL DEFAULT '',
        meta text NOT NULL DEFAULT ''
      )`,
    )
    .then(async () => {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_ts_idx ON site_events (ts)`)
      await db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_name_ts_idx ON site_events (name, ts)`)
      await db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_sid_idx ON site_events (sid)`)
    })
    .then(() => undefined)
    /* A failed CREATE must not be remembered as done. Leaving the rejected
     * promise cached would mean one bad cold start disables writes for the
     * life of the instance. */
    .catch((e) => {
      ensured = null
      throw e
    })
  return ensured as Promise<void>
}

/* Swept here rather than on a cron because the crons on this project all
 * fail closed on CRON_SECRET, and a retention sweep that stops running when
 * an env var goes missing is a table that grows forever without saying so.
 * One in roughly two hundred requests pays for it. */
async function sweep(): Promise<void> {
  if (Math.random() > 0.005) return
  const cutoff = Date.now() - RETAIN_DAYS * 864e5
  await db.execute(sql`DELETE FROM site_events WHERE ts < ${cutoff}`)
}

export async function POST(req: NextRequest) {
  let body: any = null
  try {
    body = await req.json()
  } catch {
    return ok()
  }

  const sid = str(body?.sid, 64)
  const list = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : []
  if (!sid || !list.length) return ok()

  const now = Date.now()
  const rows = list
    .map((e: any) => ({
      id: randomUUID(),
      ts: now,
      sid,
      name: str(e?.name, 40),
      page: str(e?.page),
      product: str(e?.product),
      vendor: str(e?.vendor),
      cat: str(e?.cat),
      meta: str(e?.meta),
    }))
    .filter((r: any) => ALLOWED.has(r.name))

  if (!rows.length) return ok()

  try {
    await ensureTable()
    await db.insert(siteEvents).values(rows)
    await sweep()
  } catch {
    /* swallowed on purpose: see the header */
  }
  return ok()
}

/* A beacon sent during unload cannot preflight, so the sink has to answer a
 * bare cross-origin POST. Nothing here reads a cookie or a credential, so
 * allowing any origin costs nothing: the worst an attacker gets is the
 * ability to write rows they could already write from the site itself. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  })
}
