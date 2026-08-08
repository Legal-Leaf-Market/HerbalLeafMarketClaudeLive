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
      return NextResponse.json(
        { count: out.length, coas: out.filter((p: any) => p.coa).length, byVendor },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      )
    }
    return NextResponse.json(out, { headers: { "Access-Control-Allow-Origin": "*" } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } })
  }
}
