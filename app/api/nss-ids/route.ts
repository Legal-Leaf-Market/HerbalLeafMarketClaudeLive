import { NextResponse } from "next/server"
import { getSmokingBlendsIds } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const out = await getSmokingBlendsIds(null)
    // Same shared-edge policy as /api/inventory: every visitor's page boot
    // fetches this map, and it changes on NSS's timescale, not the shopper's.
    return NextResponse.json(out, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } })
  }
}
