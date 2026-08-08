import { NextResponse } from "next/server"
import { sendWeeklyDigest } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Weekly member "Garden" digest. Scheduled via vercel.json (Mon 13:00 UTC).
// FAILS CLOSED: without CRON_SECRET set this endpoint refuses to run, because
// an unauthenticated GET here emails every consenting member. Vercel sends
// `Authorization: Bearer $CRON_SECRET` on scheduled invocations automatically
// once the env var exists, so setting it is the whole setup.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured; refusing to send email unauthenticated" },
      { status: 503 },
    )
  }
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  try {
    const result = await sendWeeklyDigest()
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
