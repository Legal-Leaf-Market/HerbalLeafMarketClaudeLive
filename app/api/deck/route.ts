import { NextResponse } from "next/server"
import { deckInventory } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/* The feed behind a maker's private "on deck" page.
 *
 * ?vendor=<exact vendor name>. Answers ONLY for stores marked `deck` in
 * SHOPIFY_STORES, so it cannot be used as a second door onto the live
 * catalogue: everything it can return is, by definition, a maker who is
 * deliberately absent from the public shelf.
 *
 * The vendor name is not a secret and this endpoint is not the lock. The lock
 * is the unguessable /deck/<token> address the page lives at, and the fact that
 * the address is sent to that maker and to nobody else. What this endpoint
 * returns is a re-presentation of the maker's own public products.json, with
 * their prices and links to their own pages, which is exactly what the page is
 * for showing them.
 *
 * no-store rather than the shelf's shared CDN cache: a deck page is read by one
 * person, a handful of times, while they decide. There is nothing to amortise
 * across visitors, and a maker who asks for a change should see it on reload
 * rather than ten minutes later. The scrape itself is cached upstream for an
 * hour in deckInventory, which is what actually protects their server.
 */
export async function GET(request: Request) {
  try {
    const vendor = new URL(request.url).searchParams.get("vendor") || ""
    if (!vendor) {
      return NextResponse.json([], { headers: { "Cache-Control": "no-store" } })
    }
    return NextResponse.json(await deckInventory(vendor), {
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
