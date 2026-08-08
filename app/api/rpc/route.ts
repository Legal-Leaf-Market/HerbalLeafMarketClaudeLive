import { NextResponse } from "next/server"
import { dispatchRpc } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const CORS = { "Access-Control-Allow-Origin": "*" }

export async function POST(request: Request) {
  let body: any = {}
  try {
    body = await request.json()
  } catch {}
  const fn = String(body.fn || "")
  const args = Array.isArray(body.args) ? body.args : []
  try {
    const out = await dispatchRpc(fn, args)
    return NextResponse.json(out, { headers: CORS })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
