import { NextResponse } from "next/server"
import { sendWeeklyClickReport } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// Weekly outbound-click report to the owner. Scheduled via vercel.json (Mon 12:00 UTC).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }
  }
  try {
    const result = await sendWeeklyClickReport()
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
