import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"

import { db } from "@/lib/db"

/**
 * The numbers behind /analytics. Admin only.
 *
 * -----------------------------------------------------------------------------
 * THE PASSWORD ARRIVES IN A POST BODY, WHICH IS THIS REPO'S CONVENTION
 *
 * /api/rpc already works this way: `{ fn, args }` with `ADMIN_PW` as args[0],
 * checked by checkAdmin() in lib/hlm.ts. Introducing a header scheme or a
 * signed cookie here would be a second auth mechanism for one page. It is over
 * HTTPS and it is never in a URL, so it stays out of logs and out of Referer.
 *
 * FAILS CLOSED. With ADMIN_PW unset this returns 503 rather than opening: an
 * unset variable is a misconfigured deployment, not an invitation.
 *
 * -----------------------------------------------------------------------------
 * AGGREGATED HERE, NEVER IN THE BROWSER
 *
 * The raw table is every click on the site. Shipping it to the client to count
 * there would mean the dashboard downloads the whole event log: slow, and a far
 * bigger thing to leak if the password ever escapes. The browser only ever
 * receives totals.
 *
 * EVERY FUNNEL STEP COUNTS DISTINCT sid, NOT EVENTS. A funnel counted in events
 * lies: one person opening six product pages looks like six steps of intent.
 * Counting sessions means each visit contributes at most one to each step, so
 * the gap between steps is a gap in people. A session is a TAB, so one person
 * over two visits is two sessions. Good for shape, wrong for "how many humans",
 * and nothing here claims the latter.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Row = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)

function noStore(json: unknown, status = 200) {
  return NextResponse.json(json, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  })
}

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const r = (await db.execute(q)) as unknown as { rows?: Row[] } | Row[]
  return Array.isArray(r) ? r : (r.rows ?? [])
}

export async function POST(request: Request) {
  const real = process.env.ADMIN_PW || ""
  if (!real) {
    return noStore(
      {
        error:
          "ADMIN_PW is not set on this deployment, so the dashboard cannot be opened. " +
          "Set it in the Vercel project and redeploy.",
      },
      503
    )
  }

  let body: { pw?: unknown; days?: unknown } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    /* fall through to the auth failure below */
  }
  if (String(body.pw ?? "") !== real) return noStore({ error: "Unauthorized" }, 401)

  // Clamped: an unbounded window is a full table scan on a shared Neon instance.
  const asked = Number(body.days)
  const days = [1, 7, 30, 90].includes(asked) ? asked : 7
  const since = sql`now() - interval '1 day' * ${days}`

  try {
    const [totals, byName, topProducts, topVendors, topCats, searches, zeroSearches, daily, funnel] =
      await Promise.all([
        rows(sql`
          SELECT count(DISTINCT sid)                                        AS sessions,
                 count(*) FILTER (WHERE name = 'page_view')                 AS views,
                 count(*) FILTER (WHERE name = 'outbound_click')            AS outbound,
                 count(DISTINCT sid) FILTER (WHERE name = 'outbound_click') AS outbound_sessions,
                 count(*) FILTER (WHERE name = 'add_to_cart')               AS carted,
                 count(*) FILTER (WHERE name = 'subscribe')                 AS subs
          FROM site_events WHERE ts >= ${since}`),

        rows(sql`
          SELECT name, count(*) AS c, count(DISTINCT sid) AS s
          FROM site_events WHERE ts >= ${since}
          GROUP BY name ORDER BY c DESC`),

        /* Ranked by the furthest thing we can observe, never by views. */
        rows(sql`
          SELECT product_id, max(vendor) AS vendor, max(cat) AS cat,
                 count(*) FILTER (WHERE name = 'outbound_click') AS clicks,
                 count(*) FILTER (WHERE name = 'product_view')   AS views,
                 count(*) FILTER (WHERE name = 'add_to_cart')    AS carted
          FROM site_events
          WHERE ts >= ${since} AND product_id IS NOT NULL
          GROUP BY product_id
          ORDER BY clicks DESC, carted DESC LIMIT 40`),

        rows(sql`
          SELECT vendor,
                 count(*) FILTER (WHERE name = 'outbound_click') AS clicks,
                 count(*) FILTER (WHERE name = 'add_to_cart')    AS carted,
                 count(DISTINCT product_id)                      AS products
          FROM site_events
          WHERE ts >= ${since} AND vendor IS NOT NULL
          GROUP BY vendor ORDER BY clicks DESC LIMIT 25`),

        rows(sql`
          SELECT coalesce(cat, '(none)') AS cat,
                 count(*) FILTER (WHERE name = 'product_view')   AS views,
                 count(DISTINCT sid)                             AS sessions,
                 count(*) FILTER (WHERE name = 'outbound_click') AS clicks
          FROM site_events WHERE ts >= ${since}
          GROUP BY 1 ORDER BY views DESC LIMIT 25`),

        rows(sql`
          SELECT meta AS term, count(*) AS c
          FROM site_events WHERE ts >= ${since} AND name = 'search' AND meta IS NOT NULL
          GROUP BY meta ORDER BY c DESC LIMIT 25`),

        /* The most actionable list on the page: each one is a thing somebody
           expected to find here and did not. */
        rows(sql`
          SELECT meta AS term, count(*) AS c
          FROM site_events WHERE ts >= ${since} AND name = 'search_zero' AND meta IS NOT NULL
          GROUP BY meta ORDER BY c DESC LIMIT 25`),

        rows(sql`
          SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD')    AS day,
                 count(DISTINCT sid)                             AS sessions,
                 count(*) FILTER (WHERE name = 'outbound_click') AS clicks
          FROM site_events WHERE ts >= ${since}
          GROUP BY 1 ORDER BY 1`),

        rows(sql`
          SELECT count(DISTINCT sid)                                        AS visited,
                 count(DISTINCT sid) FILTER (WHERE name = 'product_view')   AS opened,
                 count(DISTINCT sid) FILTER (WHERE name = 'add_to_cart')    AS carted,
                 count(DISTINCT sid) FILTER (WHERE name = 'checkout_click') AS checkout,
                 count(DISTINCT sid) FILTER (WHERE name = 'outbound_click') AS reached,
                 count(DISTINCT sid) FILTER (WHERE name = 'search')         AS searched,
                 count(DISTINCT sid) FILTER (WHERE name = 'search_zero')    AS searched_zero,
                 count(DISTINCT sid) FILTER (WHERE name = 'ritual_open')    AS ritual_open,
                 count(DISTINCT sid) FILTER (WHERE name = 'ritual_result')  AS ritual_result
          FROM site_events WHERE ts >= ${since}`),
      ])

    const t = totals[0] ?? {}
    const f = funnel[0] ?? {}

    return noStore({
      days,
      totals: {
        sessions: n(t.sessions),
        views: n(t.views),
        outbound: n(t.outbound),
        outboundSessions: n(t.outbound_sessions),
        carted: n(t.carted),
        subs: n(t.subs),
      },
      byName: byName.map((r) => ({ name: r.name, count: n(r.c), sessions: n(r.s) })),
      topProducts: topProducts.map((r) => ({
        productId: r.product_id,
        vendor: r.vendor ?? "",
        cat: r.cat ?? "",
        clicks: n(r.clicks),
        views: n(r.views),
        carted: n(r.carted),
      })),
      topVendors: topVendors.map((r) => ({
        vendor: r.vendor,
        clicks: n(r.clicks),
        carted: n(r.carted),
        products: n(r.products),
      })),
      topCats: topCats.map((r) => ({
        cat: r.cat,
        views: n(r.views),
        sessions: n(r.sessions),
        clicks: n(r.clicks),
      })),
      searches: searches.map((r) => ({ term: r.term, count: n(r.c) })),
      zeroSearches: zeroSearches.map((r) => ({ term: r.term, count: n(r.c) })),
      daily: daily.map((r) => ({ day: r.day, sessions: n(r.sessions), clicks: n(r.clicks) })),
      funnels: [
        {
          key: "browse",
          title: "Browse to maker",
          note:
            "Coverage, not a strict pipeline: a visit can reach a maker from a card without " +
            "opening a product. The last step is the goal. Whether any of them bought is only " +
            "visible in the maker's own dashboard, never here.",
          steps: [
            { label: "Visited", sessions: n(f.visited) },
            { label: "Opened a product", sessions: n(f.opened) },
            /* `goal` marks the step that is the POINT of the funnel rather than
               another rung on it, so the dashboard draws it as a win instead of
               printing a drop-off note under it in alarm red. Leaving for a
               maker is the only event here that can earn anything. */
            { label: "Reached a maker", sessions: n(f.reached), goal: true },
          ],
        },
        {
          key: "cart",
          title: "Cart",
          note: "A strict pipeline. Every step requires the one before it.",
          steps: [
            { label: "Added to cart", sessions: n(f.carted) },
            { label: "Tapped check out", sessions: n(f.checkout), goal: true },
          ],
        },
        {
          key: "ritual",
          title: "Ritual builder",
          note: "A strict pipeline. Did the recommender actually get used?",
          steps: [
            { label: "Opened it", sessions: n(f.ritual_open) },
            { label: "Got a result", sessions: n(f.ritual_result) },
          ],
        },
        {
          key: "search",
          title: "Search",
          note: "A strict pipeline. The zero-result terms below are the list worth reading.",
          steps: [
            { label: "Searched", sessions: n(f.searched) },
            { label: "Got nothing back", sessions: n(f.searched_zero) },
          ],
        },
      ],
    })
  } catch (e) {
    /* Surfaced rather than swallowed: the reader is the operator, and "the
       table does not exist yet" needs a different reaction from "the query is
       wrong". */
    return noStore({ error: String((e as Error).message ?? e) }, 500)
  }
}
