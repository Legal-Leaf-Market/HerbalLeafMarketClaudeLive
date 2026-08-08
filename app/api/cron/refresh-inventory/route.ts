import { NextResponse } from "next/server"
import { refreshInventory } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// Rebuilds the shared inventory cache every 4 hours (vercel.json), inside the
// 6h TTL, so the key never expires in normal operation and NO visitor ever
// pays for the five-store scrape: the expensive path runs here, in the
// background, where nobody is waiting. The rebuild overwrites the old copy
// atomically; it never deletes first.
//
// FAILS CLOSED like the other crons: this endpoint triggers ~10 fetches
// against the makers' servers, so an unauthenticated GET is a free
// amplification lever pointed at our partners. Set CRON_SECRET on Vercel and
// scheduled invocations authenticate themselves automatically.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured; refusing to scrape unauthenticated" },
      { status: 503 },
    )
  }
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  try {
    const result = await refreshInventory()
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
