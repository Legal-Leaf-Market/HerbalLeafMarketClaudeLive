import { db } from "./db"
import { members, clicks } from "./db/schema"
import { and, eq, gte, sql } from "drizzle-orm"
import { kvGet, kvPut, kvDel } from "./kv"

/* =========================================================================
 * Herbal Leaf Market — server logic.
 * Faithful port of the original Cloudflare Worker (src/index.js) onto Vercel
 * + Neon Postgres. Cloudflare KV -> kv table, D1 -> members/clicks tables,
 * scheduled() -> Vercel Cron routes. Email still goes through Resend.
 * ========================================================================= */

export const SITE_NAME = "Herbal Leaf Market"
export const SITE_FROM = "Herbal Leaf Market"
export const CONTACT_EMAIL = "hello@herballeafmarket.com"
export const SITE_URL = "https://herballeafmarket.com"

type ShopifyStore = {
  vendor: string
  domain: string
  prefix: string
  /* Optional product_type allow-list. Present = ONLY these types are ingested.
   * Matched case-insensitively against Shopify's product_type. This exists
   * because a vendor's whole catalogue is not necessarily a fit: Rishi sells
   * 289 things, but 46 are teaware, 25 are gift sets and 7 are "FREE GIFT"
   * placeholders. An allow-list rather than a deny-list on purpose — a new
   * product_type they invent later stays OUT until we look at it, instead of
   * silently appearing on the storefront. */
  include?: string[]
  /* Optional product_type deny-list, for stores where taking everything-but is
   * the more natural expression. Applied after `include`. */
  exclude?: string[]
  /* Optional product_type -> site category rename, applied at ingest so the
   * storefront taxonomy stays consistent. Shopify product_type is whatever the
   * vendor typed: Rishi's are SHOUTING ("LOOSE LEAF"), which would render as
   * all-caps chips sitting next to "Herbal Blends" and sort to the bottom,
   * since catRank() matches CATEGORY_ORDER exactly and "POWDERS" !== "Powders".
   * Keys are matched trimmed and case-insensitively. */
  categoryMap?: Record<string, string>
}

const SHOPIFY_STORES: ShopifyStore[] = [
  { vendor: "Puff Herbals", domain: "https://puffherbals.com", prefix: "puff" },
  { vendor: "Secret Nature", domain: "https://secretnature.com", prefix: "sn" },
  { vendor: "Soul CBD", domain: "https://mysoulcbd.com", prefix: "soul" },
  { vendor: "Charlotte's Web", domain: "https://www.charlottesweb.com", prefix: "cw" },
  /* Rishi Tea & Botanicals — added 2026-08-08.
   * Loose leaf / sachets / powders only: 187 of their 289 products.
   * Deliberately excluded, and why:
   *   ACCESSORIES (46), GIFT SETS (25), MERCHANDISE (6), FREE GIFT (7),
   *     GIFT CARD (1), OTHER (2)  -- teaware and gifting, not botanicals.
   *   SPARKLING BOTANICALS (5), CONCENTRATES (5), ICED TEA (5) -- these ship at
   *     a $12 flat rate rather than Rishi's usual $8, and SHIPPING in app.js
   *     holds ONE flat rate per vendor. Including them would quote the shopper
   *     the wrong postage. Add them only alongside per-product shipping. */
  {
    vendor: "Rishi Tea",
    domain: "https://www.rishi-tea.com",
    prefix: "rishi",
    include: ["LOOSE LEAF", "SACHETS", "POWDERS"],
    /* Loose leaf and sachets are both simply "Tea" to a shopper — the
     * distinction is packaging, not product. Powders (matcha and friends) keep
     * their own existing category so they group with other powders; isTea() in
     * app.js still counts them under the Tea facet, so they appear in both
     * places, which is correct: a matcha IS a tea AND is a powder. */
    categoryMap: { "LOOSE LEAF": "Tea", SACHETS: "Tea", POWDERS: "Powders" },
  },
]
const NSS_ORIGIN = "https://www.smokingblends.com"
const NSS_CACHE_KEY = "nss_ids_v1"

const HLM_DEFAULT_RULES = {
  evidenceFloor: "traditional",
  itemsPerRitual: 3,
  preferInStock: true,
  showEvidenceBadges: true,
  crossSellCBD: true,
  goalsEnabled: { calm: true, sleep: true, focus: true, ritual: true },
  coupons: {
    "Bear Blend": 10,
    "Puff Herbals": 15,
    "Secret Nature": 15,
    "Soul CBD": 20,
    "Natural Smoke Shop": 10,
    "Charlotte's Web": 0,
    "Rishi Tea": 0,
  },
}

/* ---------- env helpers ---------- */
const env = {
  get ADMIN_PW() { return process.env.ADMIN_PW || "" },
  get RESEND_API_KEY() { return process.env.RESEND_API_KEY || "" },
  get REPORT_EMAIL() { return process.env.REPORT_EMAIL || "" },
  get SITE_FROM_EMAIL() { return process.env.SITE_FROM_EMAIL || "" },
  get PUBLIC_URL() { return process.env.PUBLIC_URL || "" },
}

/* =========================================================================
 * Inventory (Shopify products.json scrape, cached 6h)
 * ========================================================================= */
/* Cache KEY carries a version. Bump it in the same commit as ANY change to
 * what this payload contains (new vendor, new field like coa), so the
 * deploy itself forces the next request to cold-scrape. The alternative --
 * shipping a pipeline change behind a still-warm 6h cache that only the
 * admin password can bust -- left the Secret Nature COA join invisible on
 * production for hours while the code sat correct and deployed. */
const INVENTORY_KEY = "hlm_live_v4"
/* TTL 6h, but the refresh-inventory cron rebuilds every 4h, so in normal
 * operation the key NEVER expires and no visitor ever pays for a scrape.
 * The TTL is the safety net for when the cron is down, not the schedule. */
const INVENTORY_TTL = 21600

/* The full scrape: five Shopify feeds + the Secret Nature lab page, mapped,
 * COAs joined, written to KV. This is the expensive path (~10-20s) and it is
 * meant to run from the CRON, in the background, where nobody is waiting. */
export async function buildInventory(): Promise<any[]> {
  let out: any[] = []
  try {
    const [batches, snCoas] = await Promise.all([
      Promise.all(SHOPIFY_STORES.map((s) => fetchStoreProducts(s))),
      fetchSecretNatureCoas().catch(() => new Map<string, SnDoc[]>()),
    ])
    for (let i = 0; i < batches.length; i++) {
      out = out.concat(mapShopify(SHOPIFY_STORES[i], batches[i]))
    }
    attachSecretNatureCoas(out, snCoas)
  } catch {}
  if (out.length) {
    await kvPut(INVENTORY_KEY, JSON.stringify(out), INVENTORY_TTL)
  }
  return out
}

export async function getInventory(): Promise<any[]> {
  const cached = await kvGet(INVENTORY_KEY)
  if (cached) {
    try { return JSON.parse(cached) } catch {}
  }
  /* Visitor-facing fallback for the windows the cron cannot cover: right
   * after a deploy that bumped the key, or when the cron has been failing
   * long enough for the TTL to lapse. */
  return buildInventory()
}

/* =========================================================================
 * Secret Nature COAs — join the store's own published lab PDFs to products
 *
 * Secret Nature's product feed and product pages carry ZERO COA links (probed
 * 2026-08-08: 0 lab-named images, 0 pdf hrefs in 207 body_htmls), but their
 * footer page /pages/laboratory-test-results hosts ~93 per-strain PDFs with
 * the strain in the filename. Same situation as Legal Leaf's THCA King COA
 * folder, so this is that join, ported.
 *
 * The matcher is deliberately conservative: a wrong certificate on a card is
 * far worse than a missing link. Identity is (strain key, form, cannabinoid):
 *  - strain key: camelCase-split tokens minus grade/form/chemistry noise,
 *    sorted. Empty keys NEVER match (a "D8 Live Resin" title once matched an
 *    unrelated file because both keys normalised to nothing).
 *  - form: gummy/tube/preroll/vape/drink/extract/flower. A gummy product must
 *    never link a flower certificate even for the same strain -- Secret Nature
 *    publishes Cherry Kush as flower COA, CBD-gummy COA and THC-gummy COA.
 *  - cannabinoid: a file marked with a DIFFERENT cannabinoid is never
 *    acceptable (BloodDiamondCBD must not receive BloodDiamondTHCA.pdf; the
 *    newest-first tiebreak alone made exactly that mistake in prototyping).
 * Measured against the live feed on 2026-08-08: 90 of 207 products matched,
 * every one hand-audited, zero cross-cannabinoid or cross-form joins.
 * ========================================================================= */
const SN_LAB_PAGE = "https://secretnature.com/pages/laboratory-test-results"

const SN_STOP = new Set([
  "thca", "thc", "cbd", "cbg", "cbn", "thcv", "d8", "d9", "delta", "live", "resin",
  "rosin", "infused", "flower", "flowers", "preroll", "prerolls", "pre", "roll",
  "rolls", "vape", "vapes", "cart", "cartridge", "gummy", "gummies", "smokes",
  "blunt", "blunts", "joint", "joints", "pack", "ct", "count", "oz", "gram",
  "grams", "g", "mg", "premium", "exotic", "indoor", "greenhouse", "organic",
  "hemp", "cannabis", "sungrown", "smalls", "bud", "buds", "grade", "tube",
  "tubes", "pdf", "rdf", "pt", "rd", "gh", "final", "copy", "updated", "new",
  "coa", "secret", "nature", "sa", "at", "drink", "drinks", "wholesale",
])
const SN_GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

function snWords(s: string): string[] {
  let t = s.replace(SN_GUID, " ")
  t = t.replace(/([a-z])([A-Z])/g, "$1 $2")   // camelCase: AnimalRuntzTHCA
  t = t.replace(/([A-Za-z])(\d)/g, "$1 $2")
  t = t.replace(/(\d)([A-Za-z])/g, "$1 $2")
  t = t.toLowerCase().replace(/[_\-.]+/g, " ").replace(/[^a-z0-9 ]/g, " ")
  return t.split(/\s+/).filter(Boolean)
}
function snKey(s: string): string {
  return snWords(s).filter((t) => !/^\d+$/.test(t) && !SN_STOP.has(t)).sort().join(" ")
}
function snCann(s: string): string {
  const w = new Set(snWords(s))
  if (w.has("thca")) return "thca"
  if (w.has("cbd")) return "cbd"
  if (w.has("cbg")) return "cbg"
  if (w.has("thcv")) return "thcv"
  if (w.has("d8") || (w.has("delta") && w.has("8")) || (w.has("d") && w.has("8"))) return "d8"
  if (w.has("d9") || (w.has("delta") && w.has("9")) || (w.has("d") && w.has("9")) || w.has("thc")) return "thc"
  return ""
}
function snForm(s: string): string {
  const t = s.toLowerCase()
  if (/gumm|60\s*_?ct|smacker/.test(t)) return "gummy"
  if (/tube/.test(t)) return "tube"
  if (/pre[-_ ]?roll|blunt|joint|cigarette/.test(t)) return "preroll"
  if (/vape|cart(ridge)?\b|pod|disposable/.test(t)) return "vape"
  if (/drink|soda|beverage|seltzer|tonic/.test(t)) return "drink"
  if (/distillate|extract|diamond|sauce|badder|concentrate|tincture|oil\b/.test(t)) return "extract"
  return "flower"
}

type SnDoc = { cann: string; ver: number; url: string }

async function fetchSecretNatureCoas(): Promise<Map<string, SnDoc[]>> {
  const map = new Map<string, SnDoc[]>()
  const r = await fetch(SN_LAB_PAGE, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } })
  if (r.status !== 200) return map
  const html = await r.text()
  const rx = /href=["']([^"']+\.pdf[^"']*)["']/g
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = rx.exec(html))) {
    let u = m[1]
    if (u.startsWith("//")) u = "https:" + u
    if (!/^https?:\/\//.test(u)) u = "https://secretnature.com" + u
    if (seen.has(u)) continue
    seen.add(u)
    const name = (u.split("/").pop() || "").split("?")[0]
    if (/legal_opinion/i.test(name)) continue
    const base = name.replace(/\.pdf/gi, "")
    const k = snKey(base)
    if (!k) continue
    const vm = u.match(/[?&]v=(\d+)/)
    const mk = k + " " + snForm(name)
    const arr = map.get(mk) || []
    arr.push({ cann: snCann(base), ver: vm ? Number(vm[1]) : 0, url: u })
    map.set(mk, arr)
  }
  return map
}

function snPick(cands: SnDoc[] | undefined, pcann: string): string {
  if (!cands || !cands.length) return ""
  const newest = (list: SnDoc[]) => list.slice().sort((a, b) => b.ver - a.ver)[0].url
  const exact = cands.filter((c) => c.cann === pcann)
  if (exact.length) return newest(exact)
  const unmarked = cands.filter((c) => c.cann === "")
  if (unmarked.length) return newest(unmarked)
  // product title silent on cannabinoid: accept only an unambiguous folder
  if (pcann === "" && new Set(cands.map((c) => c.cann)).size === 1) return newest(cands)
  return ""
}

function attachSecretNatureCoas(products: any[], coas: Map<string, SnDoc[]>): void {
  if (!coas.size) return
  let attached = 0
  for (const p of products) {
    if (p.vendor !== "Secret Nature") continue
    const k = snKey(p.name || "")
    if (!k) continue
    const f = snForm((p.name || "") + " " + (p.category || ""))
    const url = snPick(coas.get(k + " " + f), snCann(p.name || ""))
    if (url) { p.coa = url; attached++ }
  }
  console.log(`[inventory] Secret Nature COAs: ${coas.size} document keys, ${attached} products linked`)
}

/* Rebuild-and-overwrite, NOT delete-then-rebuild: kvDel first would leave a
 * window where a visitor lands on an empty cache and pays for the scrape --
 * the exact thing this cache exists to prevent. The old copy keeps serving
 * until the new one atomically replaces it. Used by the admin RPC and the
 * refresh-inventory cron alike. */
export async function refreshInventory(): Promise<string> {
  const n = (await buildInventory()).length
  return n + " products cached."
}

/* Shopify caps products.json at 250 rows per page. A single limit=250 call
 * therefore TRUNCATES any store with a bigger catalogue, silently — no error,
 * the feed just comes back smaller than the shop and nothing says so. Rishi has
 * 289, so they were the first vendor to expose it. Page until a short page
 * comes back.
 *
 * The page cap is a runaway guard, not a product decision. If a store ever hits
 * it we log, because a silent cap here reads as "that vendor only has 1000
 * products" and nobody would question it. */
const SHOPIFY_PAGE_LIMIT = 250
const SHOPIFY_MAX_PAGES = 4

async function fetchStoreProducts(store: ShopifyStore): Promise<any[]> {
  const all: any[] = []
  for (let page = 1; page <= SHOPIFY_MAX_PAGES; page++) {
    let r: Response | null = null
    try {
      r = await fetch(`${store.domain}/products.json?limit=${SHOPIFY_PAGE_LIMIT}&page=${page}`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      })
    } catch {
      return all
    }
    if (!r || r.status !== 200) return all
    let batch: any[] = []
    try {
      const data: any = await r.json()
      batch = (data && data.products) || []
    } catch {
      return all
    }
    all.push(...batch)
    if (batch.length < SHOPIFY_PAGE_LIMIT) return all
  }
  console.log(
    `[inventory] ${store.vendor} still had a full page at the ${SHOPIFY_MAX_PAGES}-page cap; catalogue may be truncated`,
  )
  return all
}

function mapShopify(store: ShopifyStore, products: any[]): any[] {
  const out: any[] = []
  const inc = store.include?.map((t) => t.trim().toUpperCase())
  const exc = store.exclude?.map((t) => t.trim().toUpperCase())
  const cmap: Record<string, string> = {}
  if (store.categoryMap) {
    for (const k of Object.keys(store.categoryMap)) cmap[k.trim().toUpperCase()] = store.categoryMap[k]
  }
  ;(products || []).forEach((p) => {
    if (!p || !p.handle) return
    const rawType = String(p.product_type || "").trim()
    const typeKey = rawType.toUpperCase()
    if (inc && !inc.includes(typeKey)) return
    if (exc && exc.includes(typeKey)) return
    const category = cmap[typeKey] || rawType
    const img = p.images && p.images[0] && p.images[0].src ? p.images[0].src : ""
    const vars = (p.variants || []).map((v: any) => ({
      id: String(v.id),
      title: v.title && v.title !== "Default Title" ? v.title : "",
      price: Number(v.price) || 0,
      available: v.available !== false,
    }))
    const prices = vars.map((v: any) => v.price).filter((n: number) => n > 0)
    const minP = prices.length ? Math.min.apply(null, prices) : 0
    const anyAvail = vars.some((v: any) => v.available)
    let blurb = String(p.body_html || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
    if (blurb.length > 160) blurb = blurb.slice(0, 157) + "..."
    out.push({
      id: store.prefix + "-" + p.handle,
      vendor: store.vendor,
      name: p.title || "",
      category,
      image: img,
      price: minP,
      unit: vars.length > 1 ? "from" : "",
      blurb,
      url: store.domain + "/products/" + p.handle,
      badge: "",
      inStock: anyAvail,
      variants: vars,
    })
  })
  return out
}

/* =========================================================================
 * Natural Smoke Shop (WooCommerce) variation-id scrape, cached 6h
 * ========================================================================= */
export async function getSmokingBlendsIds(slugs?: string[] | null): Promise<Record<string, any[]>> {
  const cached = await kvGet(NSS_CACHE_KEY)
  if (cached) {
    try { return JSON.parse(cached) } catch {}
  }
  if (!slugs || !slugs.length) {
    slugs = await nssCrawlSlugs()
  }
  const map: Record<string, any[]> = {}
  try {
    const resps = await Promise.all(
      slugs.map((s) =>
        fetch(NSS_ORIGIN + "/product/" + s + "/", {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
        }).catch(() => null),
      ),
    )
    for (let i = 0; i < resps.length; i++) {
      const r = resps[i]
      if (!r || r.status !== 200) continue
      try {
        const list = parseVariationsFromHtml(await r.text())
        if (list && list.length) map[slugs[i]] = list
      } catch {}
    }
  } catch {}
  if (Object.keys(map).length) {
    await kvPut(NSS_CACHE_KEY, JSON.stringify(map), 21600)
  }
  return map
}

export async function refreshSmokingBlendsIds(): Promise<string> {
  await kvDel(NSS_CACHE_KEY)
  const m = await getSmokingBlendsIds(null)
  return Object.keys(m).length + " NSS products mapped."
}

function parseVariationsFromHtml(html: string): any[] {
  const out: any[] = []
  if (!html) return out
  const m = html.match(/data-product_variations\s*=\s*(['"])(.*?)\1/is)
  if (!m || !m[2] || m[2] === "false") return out
  const jsonStr = m[2]
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
  let arr: any
  try { arr = JSON.parse(jsonStr) } catch { return out }
  ;(arr || []).forEach((v: any) => {
    const vid = v.variation_id || v.id
    if (!vid) return
    let size = ""
    if (v.attributes) {
      for (const k in v.attributes) {
        if (v.attributes[k]) { size = String(v.attributes[k]); break }
      }
    }
    const price = Number(v.display_price != null ? v.display_price : v.display_regular_price) || 0
    out.push({ id: vid, price, size })
  })
  return out
}

async function nssCrawlSlugs(): Promise<string[]> {
  const slugs: string[] = []
  try {
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(NSS_ORIGIN + "/wp-json/wc/store/v1/products?per_page=100&page=" + page, {
        headers: { Accept: "application/json" },
      })
      if (r.status !== 200) break
      const arr: any = await r.json()
      if (!arr || !arr.length) break
      arr.forEach((p: any) => {
        if (p && p.slug && p.type === "variable") slugs.push(p.slug)
      })
      if (arr.length < 100) break
    }
  } catch {}
  return slugs
}

/* =========================================================================
 * Admin rules / botanical matrix overrides (persistent kv, no TTL)
 * ========================================================================= */
function checkAdmin(pw: any): boolean {
  const real = env.ADMIN_PW
  return real !== "" && String(pw) === real
}

export async function getRules(): Promise<any> {
  try {
    const s = await kvGet("HLM_RULES")
    if (s) {
      const r = JSON.parse(s)
      for (const k in HLM_DEFAULT_RULES) {
        if ((r as any)[k] === undefined) (r as any)[k] = (HLM_DEFAULT_RULES as any)[k]
      }
      return r
    }
  } catch {}
  return HLM_DEFAULT_RULES
}

export async function saveRules(pw: any, rules: any): Promise<any> {
  if (!checkAdmin(pw)) return { ok: false, error: "unauthorized" }
  try {
    await kvPut("HLM_RULES", JSON.stringify(rules || {}))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getMatrixOverrides(): Promise<any> {
  try {
    const s = await kvGet("HLM_MATRIX_OV")
    return s ? JSON.parse(s) : {}
  } catch {
    return {}
  }
}

export async function saveMatrixOverrides(pw: any, ov: any): Promise<any> {
  if (!checkAdmin(pw)) return { ok: false, error: "unauthorized" }
  try {
    await kvPut("HLM_MATRIX_OV", JSON.stringify(ov || {}))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function getMatrix(): Promise<any> {
  return { overrides: await getMatrixOverrides(), rules: await getRules() }
}

/* =========================================================================
 * Members + clicks
 * ========================================================================= */
async function getMember(email: string): Promise<any | undefined> {
  const rows = await db.select().from(members).where(eq(members.email, email)).limit(1)
  return rows[0]
}

function validEmail(e: any): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ""))
}

export async function adminData(pw: any): Promise<any> {
  if (!checkAdmin(pw)) return { ok: false, error: "unauthorized" }
  let membersCount = 0
  let unsub = 0
  try {
    const rows = await db
      .select({
        n: sql<number>`count(*)`,
        u: sql<number>`sum(case when ${members.unsubscribed} = 'unsub' then 1 else 0 end)`,
      })
      .from(members)
    membersCount = Number(rows[0]?.n || 0)
    unsub = Number(rows[0]?.u || 0)
  } catch {}
  let clicksStats: any = null
  try {
    clicksStats = await clickStats(7)
  } catch {}
  return {
    ok: true,
    rules: await getRules(),
    overrides: await getMatrixOverrides(),
    members: membersCount,
    unsub,
    clicks: clicksStats,
  }
}

export async function logClick(payload: any): Promise<any> {
  payload = payload || {}
  try {
    await db.insert(clicks).values({
      ts: Date.now(),
      type: String(payload.type || "outbound").slice(0, 40),
      vendor: String(payload.vendor || "").slice(0, 80),
      product: String(payload.product || "").slice(0, 140),
      price: Number(payload.price) || 0,
      category: String(payload.category || "").slice(0, 60),
      page: String(payload.page || "").slice(0, 60),
      device: String(payload.device || "").slice(0, 20),
      email: String(payload.email || "").slice(0, 120),
      ref: String(payload.ref || "").slice(0, 120),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function clickStats(days: number): Promise<any> {
  days = days || 7
  const since = Date.now() - days * 864e5
  const rows = await db
    .select({ type: clicks.type, vendor: clicks.vendor, product: clicks.product })
    .from(clicks)
    .where(gte(clicks.ts, since))
  let total = 0
  const byVendor: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const prod: Record<string, number> = {}
  rows.forEach((row) => {
    total++
    const v = row.vendor || "(none)"
    byVendor[v] = (byVendor[v] || 0) + 1
    const t = row.type || "outbound"
    byType[t] = (byType[t] || 0) + 1
    if (row.product) {
      const key = (row.vendor || "") + " \u2014 " + (row.product || "")
      prod[key] = (prod[key] || 0) + 1
    }
  })
  const top = Object.keys(prod)
    .map((k) => ({ name: k, n: prod[k] }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
  return { total, byVendor, byType, top, days }
}

export async function getClickStats(days: number): Promise<any> {
  return await clickStats(days || 7)
}

export async function sendWeeklyClickReport(): Promise<string> {
  const s = await clickStats(7)
  const vend = Object.keys(s.byVendor)
    .map((k) => ({ k, n: s.byVendor[k] }))
    .sort((a, b) => b.n - a.n)
  const vrows =
    vend
      .map(
        (r) =>
          '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">' +
          esc(r.k) +
          '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700">' +
          r.n +
          "</td></tr>",
      )
      .join("") || '<tr><td style="padding:10px;color:#6d6a58">No clicks yet.</td></tr>'
  const prows = s.top
    .map(
      (r: any) =>
        '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">' +
        esc(r.name) +
        '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700">' +
        r.n +
        "</td></tr>",
    )
    .join("")
  const html =
    '<!DOCTYPE html><html><body style="margin:0;background:#f1ead9;padding:24px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fdfbf3;border:1px solid #d6c9ac;border-radius:18px;overflow:hidden"><tr><td style="background:linear-gradient(135deg,#3a7b50,#265a39);padding:20px 26px;color:#f5efdd;font:900 20px Georgia,serif">Herbal Leaf Market &mdash; Weekly Click Report</td></tr><tr><td style="padding:22px 26px"><div style="font:800 34px Georgia,serif;color:#2f5d3a">' +
    s.total +
    '</div><div style="font:400 14px sans-serif;color:#6d6a58;margin-bottom:14px">outbound clicks in the last 7 days</div><div style="font:700 13px sans-serif;color:#265a39;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">By store (partner leverage)</div><table style="width:100%;border-collapse:collapse;font:14px sans-serif">' +
    vrows +
    "</table>" +
    (prows
      ? '<div style="font:700 13px sans-serif;color:#265a39;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 4px">Top products clicked</div><table style="width:100%;border-collapse:collapse;font:14px sans-serif">' +
        prows +
        "</table>"
      : "") +
    "</td></tr></table></body></html>"
  const to = env.REPORT_EMAIL || CONTACT_EMAIL
  await send(to, "\u{1F4C8} HLM weekly click report \u2014 " + s.total + " clicks", html)
  return s.total + " clicks reported."
}

export async function createAccount(payload: any): Promise<any> {
  payload = payload || {}
  try {
    const email = String(payload.email || "").trim().toLowerCase()
    if (!validEmail(email)) return { ok: false, error: "invalid email" }
    const name = String(payload.name || "").trim()
    const items = Array.isArray(payload.items) ? payload.items : []
    const consent = payload.consent ? "yes" : "no"
    const now = Date.now()
    let member = await getMember(email)
    let notified: Record<string, any> = {}
    if (member) {
      let cur: Record<string, any> = {}
      try { cur = JSON.parse(member.garden || "{}") } catch {}
      try { notified = JSON.parse(member.notified || "{}") } catch {}
      items.forEach((it: any) => { if (it && it.id) cur[it.id] = it })
      const newName = name || member.name || ""
      const newConsent = consent === "yes" ? "yes" : member.consent || "no"
      await db
        .update(members)
        .set({ name: newName, garden: JSON.stringify(cur), consent: newConsent, unsubscribed: "" })
        .where(eq(members.email, email))
      member = await getMember(email)
    } else {
      const g: Record<string, any> = {}
      items.forEach((it: any) => { if (it && it.id) g[it.id] = it })
      await db.insert(members).values({
        email,
        name,
        joined: now,
        garden: JSON.stringify(g),
        notified: "{}",
        consent,
        unsubscribed: "",
        lastEmail: 0,
      })
      member = await getMember(email)
    }
    if (String(member.unsubscribed || "") !== "unsub") {
      await sendWelcome(email, name, items, notified)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function watchItem(payload: any): Promise<any> {
  payload = payload || {}
  try {
    const email = String(payload.email || "").trim().toLowerCase()
    const it = payload.item || {}
    if (!validEmail(email) || !it || !it.id) return { ok: false }
    let member = await getMember(email)
    if (!member) {
      return await createAccount({ email, name: payload.name || "", items: [it], consent: true })
    }
    if (String(member.unsubscribed || "") === "unsub") return { ok: false, error: "unsubscribed" }
    let garden: Record<string, any> = {}
    let notified: Record<string, any> = {}
    try { garden = JSON.parse(member.garden || "{}") } catch {}
    try { notified = JSON.parse(member.notified || "{}") } catch {}
    garden[it.id] = it
    const sent = await send(
      email,
      "\u{1F33F} You're tracking " + (it.name || "an item") + " on " + SITE_NAME,
      emailShell(
        "You're tracking a new find \u{1F33F}",
        "We'll keep this in your Garden. Here's what you saved:",
        itemCardHtml(it),
        email,
      ),
    )
    notified[it.id] = (notified[it.id] || 0) + 1
    await db
      .update(members)
      .set({ garden: JSON.stringify(garden), notified: JSON.stringify(notified), lastEmail: Date.now() })
      .where(eq(members.email, email))
    return { ok: true, emailed: sent }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function sendWelcome(email: string, name: string, items: any[], notified: Record<string, any>): Promise<void> {
  const hi = name ? "Welcome, " + name.split(" ")[0] + "!" : "Welcome to your Garden!"
  const cards =
    items && items.length
      ? items.map((it) => itemCardHtml(it)).join("")
      : '<tr><td style="padding:14px;color:#6d6a58;font:15px sans-serif">Your Garden is ready \u2014 tap the \u2764 on any product to grow it.</td></tr>'
  await send(
    email,
    "\u{1F33F} Your Herbal Leaf Market Garden",
    emailShell(hi, "Your saved botanicals are below. We'll email you when you track new finds.", cards, email),
  )
  try {
    const n = notified || {}
    ;(items || []).forEach((it) => { if (it && it.id) n[it.id] = 1 })
    await db.update(members).set({ notified: JSON.stringify(n), lastEmail: Date.now() }).where(eq(members.email, email))
  } catch {}
}

export async function unsubscribe(email: string): Promise<string> {
  email = String(email || "").trim().toLowerCase()
  try {
    const m = await getMember(email)
    if (m) await db.update(members).set({ unsubscribed: "unsub" }).where(eq(members.email, email))
  } catch {}
  return (
    '<div style="font:16px sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#22271e"><h2 style="font-family:Georgia,serif;color:#2f5d3a">You\'re unsubscribed \u{1F33F}</h2><p>' +
    esc(email) +
    " will no longer receive Garden emails.</p></div>"
  )
}

export async function sendWeeklyDigest(): Promise<string> {
  const rows = await db.select().from(members)
  let sent = 0
  for (const m of rows) {
    const email = String(m.email).toLowerCase()
    if (!validEmail(email)) continue
    if (String(m.consent || "") !== "yes" || String(m.unsubscribed || "") === "unsub") continue
    let garden: Record<string, any> = {}
    try { garden = JSON.parse(m.garden || "{}") } catch {}
    const items = Object.keys(garden).map((k) => garden[k])
    if (!items.length) continue
    const name = String(m.name || "")
    const cards = items.slice(0, 12).map((it) => itemCardHtml(it)).join("")
    const hi = name ? "Your Garden this week, " + name.split(" ")[0] : "Your Garden this week"
    const ok = await send(
      email,
      "\u{1F33F} Your Herbal Leaf Market Garden \u2014 weekly recap",
      emailShell(hi, "Here are the botanicals you're growing. Ready to bring any home?", cards, email),
    )
    if (ok) {
      sent++
      try {
        await db.update(members).set({ lastEmail: Date.now() }).where(eq(members.email, email))
      } catch {}
    }
  }
  return sent + " digest email(s) sent."
}

export async function gardenSelfTest(): Promise<any> {
  const me = env.REPORT_EMAIL || CONTACT_EMAIL
  return await createAccount({
    email: me,
    name: "Test Gardener",
    consent: true,
    items: [
      {
        id: "demo1",
        name: "Calm CBD Gummies",
        vendor: "Charlotte's Web",
        price: 49.99,
        image: "https://herballeafmarket.com/icon-192.png",
        url: "https://www.charlottesweb.com/",
        blurb: "Full-spectrum CBD gummies with lemon balm.",
      },
    ],
  })
}

/* =========================================================================
 * Email builders (verbatim from the Worker) + Resend transport
 * ========================================================================= */
function cardHref(it: any): string {
  const id = String((it && it.id) || "").trim()
  if (!id) return SITE_URL + "/"
  return SITE_URL + "/?focus=" + encodeURIComponent(id)
}

function cartAddHref(it: any): string {
  const id = String((it && it.id) || "").trim()
  if (!id) return SITE_URL + "/"
  const vid = String((it && it.variantId) || "").trim()
  const key = vid ? id + "::" + vid : id
  return SITE_URL + "/?add=" + encodeURIComponent(key)
}

function itemCardHtml(it: any): string {
  it = it || {}
  const url = esc(cardHref(it))
  const name = esc(it.name || "")
  const vendor = esc(it.vendor || "")
  const blurb = it.blurb ? esc(String(it.blurb).slice(0, 150)) : ""
  const variant = esc(it.variant || it.variantTitle || "")
  const price = (Number(it.price) || 0) > 0 ? "$" + Number(it.price).toFixed(2) + (it.unit === "from" ? " +" : "") : ""
  const imgInner = it.image
    ? '<img src="' +
      esc(it.image) +
      '" width="120" height="120" alt="' +
      name +
      '" style="display:block;width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid #e0d3bd" />'
    : '<div style="width:120px;height:120px;border-radius:12px;background:#eef0e2"></div>'
  const imgCell =
    '<a href="' + url + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">' + imgInner + "</a>"
  const nameHtml =
    '<a href="' + url + '" target="_blank" rel="noopener" style="color:#22271e;text-decoration:none">' + name + "</a>"
  const variantHtml = variant
    ? '<div style="display:inline-block;font:700 12px sans-serif;color:#265a39;background:#eaf1e6;border:1px solid #cddcc8;border-radius:999px;padding:3px 10px;margin:3px 0">Size: ' +
      variant +
      "</div>"
    : ""
  const priceHtml = price
    ? '<div style="font:800 16px Georgia,serif;color:#1f6b52;margin:2px 0">' + price + "</div>"
    : ""
  const blurbHtml = blurb
    ? '<div style="font:400 13px sans-serif;color:#6d6a58;line-height:1.5;margin-top:4px">' + blurb + "</div>"
    : ""
  const addUrl = esc(cartAddHref(it))
  const cta =
    '<div style="margin-top:10px"><a href="' +
    addUrl +
    '" target="_blank" rel="noopener" style="display:inline-block;background:#c85a34;color:#ffffff;text-decoration:none;font:700 13px sans-serif;padding:10px 18px;border-radius:999px">&#128722; Add to Herbal Leaf Cart</a></div>'
  return (
    '<tr><td style="padding:14px 0;border-bottom:1px solid #eee"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%"><tr><td valign="top" width="132" style="width:132px">' +
    imgCell +
    '</td><td valign="top" style="padding-left:14px"><div style="font:700 11px sans-serif;letter-spacing:.6px;text-transform:uppercase;color:#265a39">' +
    vendor +
    '</div><div style="font:700 17px Georgia,serif;color:#22271e;margin:2px 0 4px">' +
    nameHtml +
    "</div>" +
    variantHtml +
    priceHtml +
    blurbHtml +
    cta +
    "</td></tr></table></td></tr>"
  )
}

function emailShell(heading: string, intro: string, cardsHtml: string, email: string): string {
  let unsub = ""
  try {
    unsub = (env.PUBLIC_URL || SITE_URL) + "/?unsub=" + encodeURIComponent(email)
  } catch {
    unsub = "mailto:" + CONTACT_EMAIL + "?subject=unsubscribe"
  }
  const unsubE = esc(unsub)
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0;background:#f1ead9;padding:24px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="560" style="max-width:560px;margin:0 auto;background:#fdfbf3;border:1px solid #d6c9ac;border-radius:18px;overflow:hidden"><tr><td style="background:linear-gradient(135deg,#3a7b50,#265a39);padding:22px 26px"><div style="font:900 20px Georgia,serif;color:#f5efdd">Herbal Leaf Market</div><div style="font:italic 400 12px Georgia,serif;color:#c9962f;letter-spacing:2px;text-transform:uppercase">botanical apothecary</div></td></tr><tr><td style="padding:24px 26px 6px"><div style="font:900 22px Georgia,serif;color:#2f5d3a">' +
    esc(heading) +
    '</div><div style="font:400 15px sans-serif;color:#6d6a58;margin:6px 0 8px;line-height:1.5">' +
    esc(intro) +
    '</div></td></tr><tr><td style="padding:0 26px 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">' +
    cardsHtml +
    '</table></td></tr><tr><td style="padding:16px 26px;background:#f6f1e4;border-top:1px solid #e6dcc4"><div style="font:400 11px sans-serif;color:#9c9a84;line-height:1.6">You are receiving this because you created or updated a Garden at Herbal Leaf Market. We link you to independent makers; you complete purchases on their sites. Statements have not been evaluated by the FDA and are not intended to diagnose, treat, cure, or prevent any disease. 21+.<br /><a href="' +
    unsubE +
    '" style="color:#9c3d1a;text-decoration:underline">Unsubscribe</a> at any time. <a href="https://herballeafmarket.com/privacy.html" style="color:#9c9a84;text-decoration:underline">Privacy</a> &middot; <a href="https://herballeafmarket.com/terms.html" style="color:#9c9a84;text-decoration:underline">Terms</a></div></td></tr></table></body></html>'
  )
}

function esc(s: any): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  try {
    if (!env.RESEND_API_KEY) {
      console.error("[hlm:send] RESEND_API_KEY missing; skipping send to " + to)
      return false
    }
    // SITE_FROM_EMAIL may be just a domain (e.g. "send.herballeafmarket.com") or a
    // full address. Normalise it to "Name <email@domain>" that Resend requires.
    let raw = env.SITE_FROM_EMAIL || ""
    let from: string
    if (!raw) {
      from = SITE_FROM + " <" + CONTACT_EMAIL + ">"
    } else if (raw.includes("@")) {
      // Already looks like an email address — wrap if not already wrapped
      from = raw.includes("<") ? raw : SITE_FROM + " <" + raw + ">"
    } else {
      // It's just a domain — prefix with "noreply@"
      from = SITE_FROM + " <noreply@" + raw.replace(/^https?:\/\//, "") + ">"
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (r.status >= 200 && r.status < 300) return true
    console.error("[hlm:send] FAILED status=" + r.status + " body=" + (await r.text()))
    return false
  } catch (e) {
    console.error("[hlm:send] EXCEPTION: " + e)
    return false
  }
}

/* =========================================================================
 * RPC dispatch (mirrors the Worker's RPC map)
 * ========================================================================= */
type Handler = (args: any[]) => Promise<any>

/* PUBLIC functions are what the storefront actually calls (app.js via the
 * hlm-api.js shim). Everything else is owner tooling, and /api/rpc is an
 * unauthenticated endpoint with Access-Control-Allow-Origin:* -- before this
 * split, ANY page on the internet could POST {fn:"hlmSendWeeklyDigest"} and
 * email the entire member list, force a re-scrape of five vendors' feeds, or
 * read the click analytics. Grepped every page in public/: none of the gated
 * six had a single caller, so nothing client-side changes. */
const RPC: Record<string, Handler> = {
  hlmWatchItem: (a) => watchItem(a[0] || {}),
  hlmCreateAccount: (a) => createAccount(a[0] || {}),
  hlmLogClick: (a) => logClick(a[0] || {}),
  hlmGetRules: () => getRules(),
  hlmGetMatrix: () => getMatrix(),
  getInventory: () => getInventory(),
  getSmokingBlendsIds: (a) => getSmokingBlendsIds(a && a[0]),
  hlmGetMatrixOverrides: () => getMatrixOverrides(),
  /* These three take the admin password as their first argument and verify it
   * themselves through checkAdmin(), which fails closed when ADMIN_PW is
   * unset. They stay in the map because admin.html calls them. */
  hlmAdminData: (a) => adminData(a[0]),
  hlmSaveRules: (a) => saveRules(a[0], a[1]),
  hlmSaveMatrixOverrides: (a) => saveMatrixOverrides(a[0], a[1]),
}

/* Owner-only: first argument MUST be the admin password. The wrapper keeps the
 * handlers themselves untouched (the cron routes call sendWeeklyDigest and
 * sendWeeklyClickReport directly, without a password, guarded by CRON_SECRET). */
const ADMIN_RPC: Record<string, Handler> = {
  refreshInventory: () => refreshInventory(),
  refreshSmokingBlendsIds: () => refreshSmokingBlendsIds(),
  hlmGetClickStats: (a) => getClickStats((a && a[1]) || 7),
  hlmSendWeeklyDigest: () => sendWeeklyDigest(),
  hlmSendWeeklyClickReport: () => sendWeeklyClickReport(),
  hlmGardenSelfTest: () => gardenSelfTest(),
}

export async function dispatchRpc(fn: string, args: any[]): Promise<any> {
  const a = Array.isArray(args) ? args : []
  const admin = ADMIN_RPC[fn]
  if (admin) {
    if (!checkAdmin(String(a[0] ?? ""))) return { ok: false, error: "unauthorized" }
    return await admin(a)
  }
  const handler = RPC[fn]
  if (!handler) return { ok: false, error: "unknown function: " + fn }
  return await handler(a)
}
