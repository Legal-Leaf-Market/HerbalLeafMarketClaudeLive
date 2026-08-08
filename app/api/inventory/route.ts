import { NextResponse } from "next/server"
import { getInventory } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// ?debug returns counts instead of the payload: per-vendor totals, in-stock,
// and how many products carry a joined COA. House standard from the sister
// sites (scraper observability): when the catalogue looks wrong, this answers
// "is it the data or the page?" in one request, with no auth and no PII.
// The bare response shape (a plain array) is a frozen contract -- app.js and
// the hlm-api.js shim both consume it -- so debug is a separate view, never a
// mutation of the default one.
// SHARED CDN CACHE on the catalogue response, Legal Leaf's exact numbers:
// s-maxage=600 lets Vercel's edge serve the same copy to every visitor in a
// region for 10 minutes without invoking this function at all, and
// stale-while-revalidate=3600 means that even after those 10 minutes the NEXT
// visitor still gets the cached copy instantly while the edge refreshes in the
// background. Nobody waits on a function, let alone a scrape. max-age stays 0:
// the BROWSER must not cache it, or a shopper could not pull-to-refresh a
// price; the sharing happens at the edge, not on the device.
const CDN_CACHE = "public, max-age=0, s-maxage=600, stale-while-revalidate=3600"

export async function GET(request: Request) {
  try {
    const out = await getInventory()
    if (new URL(request.url).searchParams.has("debug")) {
      const byVendor: Record<string, { total: number; inStock: number; coas: number }> = {}
      for (const p of out) {
        const v = (byVendor[p.vendor] ||= { total: 0, inStock: 0, coas: 0 })
        v.total++
        if (p.inStock !== false) v.inStock++
        if (p.coa) v.coas++
      }
      // debug is an operator's live view; caching it would defeat its purpose
      return NextResponse.json(
        { count: out.length, coas: out.filter((p: any) => p.coa).length, byVendor },
        { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } },
      )
    }
    return NextResponse.json(out, {
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": CDN_CACHE },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } })
  }
}
