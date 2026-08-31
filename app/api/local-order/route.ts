import { NextResponse } from "next/server"
import { kvGet, kvPut } from "@/lib/kv"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/* Local pickup orders: created by a shopper, redeemed by the shop.
 *
 * THE ONLY THING THIS MOVES IS A RECORD. No payment, no card, no basket held
 * on our side. A shopper sends their list to a shop; the shop scans the code
 * when the shopper collects and types what was actually spent. That is the
 * whole transaction as far as this site is concerned, and the commission is
 * computed from it afterwards.
 *
 * WHY THE SHOP TYPES A TOTAL. A scan proves a pickup happened, not what it was
 * worth. People add things at the counter and things go out of stock, so the
 * list total is a starting point and never the bill. Taking the list total as
 * the commission base would quietly overcharge a shop on every order where
 * something was unavailable, which is the failure most likely to end the
 * relationship and least likely to be noticed.
 *
 * THE TOKEN IS THE AUTHENTICATION, and that is a deliberate trade rather than
 * an oversight. Requiring shop logins would mean shop accounts, password
 * resets and a support burden, for shops chosen precisely because they have no
 * systems. Whoever holds the link can redeem, and holding the link means
 * holding the shopper's own list. The exposure is one order, it is a record
 * rather than money, and every redemption is stamped so a wrong one can be
 * seen. Revisit this the day it guards anything that can be spent.
 */

const TTL = 60 * 60 * 24 * 30 // thirty days: a list is a plan, not an archive
const COMMISSION = 0.05

type Line = { name: string; qty: number; price: number; size?: string }
type Order = {
  token: string
  shopId: string
  shopName: string
  town: string
  items: Line[]
  listTotal: number
  name: string
  phone: string
  when: string
  createdAt: string
  redeemedAt?: string
  finalTotal?: number
  commission?: number
}

function key(t: string) { return "hlm_localorder_" + t }

/* 32 hex from the platform CSPRNG. Math.random would be a guessable token, and
 * a guessable token is somebody else's order. */
function newToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")
}

/* Strip control characters and cap the length. Everything here is typed by a
 * stranger and rendered back to a shop, so nothing reaches storage unbounded. */
function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
}

async function load(t: string): Promise<Order | null> {
  if (!/^[a-f0-9]{32}$/.test(t)) return null
  const raw = await kvGet(key(t))
  if (!raw) return null
  try { return JSON.parse(raw) as Order } catch { return null }
}

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t") || ""
  const o = await load(t)
  if (!o) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  return NextResponse.json({ ok: true, order: o }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  let body: any = {}
  try { body = await request.json() } catch {}
  const action = String(body.action || "create")

  if (action === "create") {
    const items: Line[] = (Array.isArray(body.items) ? body.items : []).slice(0, 60).map((i: any) => ({
      name: clean(i && i.name, 120),
      qty: Math.max(1, Math.min(99, Number(i && i.qty) || 1)),
      price: Math.max(0, Number(i && i.price) || 0),
      size: clean(i && i.size, 40),
    })).filter((i: Line) => i.name)
    if (!items.length) {
      return NextResponse.json({ ok: false, error: "no items" }, { status: 400 })
    }
    const token = newToken()
    const order: Order = {
      token,
      shopId: clean(body.shopId, 60),
      shopName: clean(body.shopName, 120),
      town: clean(body.town, 60),
      items,
      listTotal: items.reduce((n, i) => n + i.price * i.qty, 0),
      name: clean(body.name, 80),
      phone: clean(body.phone, 40),
      when: clean(body.when, 80),
      createdAt: new Date().toISOString(),
    }
    await kvPut(key(token), JSON.stringify(order), TTL)
    return NextResponse.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } })
  }

  if (action === "redeem") {
    const t = clean(body.t, 40)
    const o = await load(t)
    if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 })
    /* Redeeming twice is a double count, and on a busy counter it will happen:
     * two people scan, or one scans and reloads. First redemption wins and the
     * second is told so, rather than silently overwriting a total somebody has
     * already typed in. */
    if (o.redeemedAt) {
      return NextResponse.json({ ok: false, error: "already redeemed", order: o }, { status: 409 })
    }
    const total = Math.max(0, Number(body.total) || 0)
    o.redeemedAt = new Date().toISOString()
    o.finalTotal = total
    o.commission = Math.round(total * COMMISSION * 100) / 100
    await kvPut(key(t), JSON.stringify(o), TTL)
    return NextResponse.json({ ok: true, order: o }, { headers: { "Cache-Control": "no-store" } })
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 })
}
