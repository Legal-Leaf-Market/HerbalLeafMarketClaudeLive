import { NextResponse } from "next/server"
import { getInventory } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const out = await getInventory()
    return NextResponse.json(out, { headers: { "Access-Control-Allow-Origin": "*" } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } })
  }
}
