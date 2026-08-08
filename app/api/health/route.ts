import { NextResponse } from "next/server"
import { SITE_NAME } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { ok: true, site: SITE_NAME, ts: Date.now() },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  )
}
