import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { siteEvents } from "@/lib/db/schema"

/**
 * The event sink. Public, unauthenticated, and always answers 204.
 *
 * -----------------------------------------------------------------------------
 * ALWAYS 204, EVEN WHEN IT FAILS
 *
 * Nothing a visitor does should get worse because analytics broke. A 500 here
 * would appear in the console of somebody who did nothing wrong, and on a
 * beacon sent during page unload it is a retry nobody wants. A database outage
 * silently drops events.
 *
 * The cost is real and worth naming: if Neon is down for an hour, that hour is
 * missing from /analytics with nothing marking it. Read a sudden flat spot as a
 * possible outage before reading it as a drop in traffic.
 *
 * -----------------------------------------------------------------------------
 * AN OPEN ENDPOINT THAT WRITES ROWS
 *
 * Anyone can POST here, so everything is clamped: a cap on events per request,
 * a cap on string lengths, and an allow-list on the name. Without the
 * allow-list a script could fill the table with invented names and the
 * dashboard would render them as though they were real features of the site.
 *
 * Deliberately NOT rate limited by IP: limiting by IP means holding an IP, and
 * the whole design of this table is that it holds nothing identifying. A padded
 * table is a cheaper problem than a log of who visited, and the retention sweep
 * clears it either way.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_EVENTS = 40
const MAX_LEN = 200
/** Long enough to see a season, short enough to stay bounded. */
const RETAIN_DAYS = 120

/** Must stay in step with the vocabulary in public/js/events.js. */
const ALLOWED = new Set([
  "page_view",
  "product_view",
  "category_view",
  "store_view",
  "search",
  "search_zero",
  "add_to_cart",
  "cart_open",
  "checkout_click",
  /** The money event. The last thing we can see before a maker takes over. */
  "outbound_click",
  "wish_add",
  "ritual_open",
  "ritual_result",
  "coa_open",
  "facts_open",
  "sister_click",
  "subscribe",
])

function ok() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}

function str(v: unknown, max = MAX_LEN): string | null {
  if (typeof v !== "string") return null
  const s = v.trim().slice(0, max)
  return s || null
}

let ensured: Promise<void> | null = null
function ensureTable(): Promise<void> {
  ensured ??= db
    .execute(
      sql`CREATE TABLE IF NOT EXISTS site_events (
        id text PRIMARY KEY,
        ts timestamptz NOT NULL DEFAULT now(),
        sid text NOT NULL,
        name text NOT NULL,
        path text,
        product_id text,
        vendor text,
        cat text,
        meta text
      )`
    )
    .then(() => db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_ts_idx ON site_events (ts)`))
    .then(() => db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_name_ts_idx ON site_events (name, ts)`))
    .then(() => db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_sid_idx ON site_events (sid)`))
    .then(() => db.execute(sql`CREATE INDEX IF NOT EXISTS site_events_product_idx ON site_events (product_id)`))
    .then(() => undefined)
    .catch((e) => {
      ensured = null
      throw e
    })
  return ensured
}

/**
 * Retention, swept opportunistically rather than on a cron.
 *
 * This repo does have crons (app/api/cron/*), but adding one for a DELETE is
 * more moving parts than the problem deserves. Roughly one request in two
 * hundred sweeps, which bounds the table without putting a delete in the hot
 * path of every beacon.
 */
async function maybeSweep(): Promise<void> {
  if (Math.random() > 1 / 200) return
  try {
    await db.execute(
      sql`DELETE FROM site_events WHERE ts < now() - interval '1 day' * ${RETAIN_DAYS}`
    )
  } catch {
    /* a failed sweep is not worth a log line on a beacon */
  }
}

export async function POST(req: NextRequest) {
  let body: { events?: unknown }
  try {
    body = (await req.json()) as { events?: unknown }
  } catch {
    return ok()
  }

  const raw = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : []
  const rows = raw
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>
      const name = str(o.name, 40)
      const sid = str(o.sid, 40)
      if (!name || !sid || !ALLOWED.has(name)) return null
      return {
        id: randomUUID(),
        sid,
        name,
        path: str(o.path),
        productId: str(o.productId),
        vendor: str(o.vendor, 80),
        cat: str(o.cat, 60),
        meta: str(o.meta),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (!rows.length) return ok()

  try {
    await ensureTable()
    await db.insert(siteEvents).values(rows)
    await maybeSweep()
  } catch {
    /* fail open: see the note at the top */
  }
  return ok()
}
