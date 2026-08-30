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
   * because a vendor's whole catalogue is not necessarily a fit: a tea maker
   * with 289 listings can easily have 46 pieces of teaware, 25 gift sets and 7
   * "FREE GIFT" placeholders among them. An allow-list rather than a deny-list
   * on purpose: a new product_type they invent later stays OUT until we look at
   * it, instead of silently appearing on the storefront. */
  include?: string[]
  /* Optional product_type deny-list, for stores where taking everything-but is
   * the more natural expression. Applied after `include`. */
  exclude?: string[]
  /* Optional product_type -> site category rename, applied at ingest so the
   * storefront taxonomy stays consistent. Shopify product_type is whatever the
   * vendor typed, and plenty of them SHOUT ("LOOSE LEAF"), which would render
   * as an all-caps chip sitting next to "Herbal Blends" and sort to the bottom,
   * since catRank() matches CATEGORY_ORDER exactly and "POWDERS" !== "Powders".
   * Keys are matched trimmed and case-insensitively. */
  categoryMap?: Record<string, string>
  /* Registered but NOT scraped. A pending store is a maker we have signed up to
   * in every other respect (affiliate config, shipping, checkout route) whose
   * feed nobody has actually read yet, so there is no honest `include` list to
   * give it and no verified shipping rate to price it with. buildInventory
   * skips these and says so in the log.
   *
   * The alternative, ingesting an unread feed, is the worse failure in both
   * directions: with no include list the shelf fills with whatever the maker
   * happens to sell (gift cards, teaware, subscriptions), and with a guessed
   * one the store matches nothing and reads as a maker with an empty
   * catalogue. Run scripts/vendor_probe.py against the domain, read the
   * product_type histogram it prints, write the include/categoryMap from what
   * is actually there, read the shipping rate off the maker's own checkout into
   * SHIPPING in app.js, then delete this flag. */
  pending?: boolean
}

const SHOPIFY_STORES: ShopifyStore[] = [
  { vendor: "Puff Herbals", domain: "https://puffherbals.com", prefix: "puff" },
  { vendor: "Secret Nature", domain: "https://secretnature.com", prefix: "sn" },
  { vendor: "Soul CBD", domain: "https://mysoulcbd.com", prefix: "soul" },
  { vendor: "Charlotte's Web", domain: "https://www.charlottesweb.com", prefix: "cw" },
  /* ---- impact.com intake, registered 2026-08-12, all PENDING ----
   * Six makers whose affiliate, shipping and checkout registrations are in
   * place (see BRAND_AFFILIATES, SHIPPING and SHOPIFY_VENDORS in app.js) but
   * whose feeds have not been read, so none of them is scraped yet. Each needs
   * one probe run before it can carry an include list worth trusting; until
   * then `pending` keeps an unexamined catalogue off the shelf. See the
   * `pending` doc on ShopifyStore for the sequence.
   *
   * St. Francis Herb Farm and RE Botanicals are registered everywhere else but
   * are absent from THIS list on purpose: both run WordPress, not Shopify, so
   * there is no products.json to page through. Ingesting either means a
   * scraper of the shape getSmokingBlendsIds() uses for Natural Smoke Shop,
   * which is a separate piece of work rather than a row in this table. */
  { vendor: "Tea For Guys", domain: "https://teaforguys.com", prefix: "tfg", pending: true },
  { vendor: "Purest Mushrooms", domain: "https://purestmushrooms.com", prefix: "pmush", pending: true },
  { vendor: "Wooden Spoon Herbs", domain: "https://woodenspoonherbs.com", prefix: "wsh", pending: true },
  { vendor: "Balls Deep Tea Company", domain: "https://ballsdeeptea.com", prefix: "bdt", pending: true },
  { vendor: "Republic of Tea", domain: "https://www.republicoftea.com", prefix: "rot", pending: true },
  /* .ca, not .com: Tea Sparrow is Vancouver-based and republicoftea.com's
   * neighbour in the tld is a different company entirely. */
  { vendor: "Tea Sparrow", domain: "https://www.teasparrow.ca", prefix: "tspw", pending: true },
  /* Encha sells whisks, bowls and scoops in an /collections/accessories
   * alongside the matcha, so this one will definitely need an include list
   * rather than the whole feed, and it must NOT be given a TEA_VENDORS
   * shortcut in app.js. Matcha is a powder AND a tea, so once the real
   * product_types are known the powders keep their own category and isTea()
   * picks them up as well, the way a matcha should appear in both places. */
  { vendor: "Encha Matcha", domain: "https://encha.com", prefix: "encha", pending: true },
]
/* =========================================================================
 * impact.com programmes
 *
 * Which programme to apply to, per maker, from the marketplace export of
 * 2026-08-11 (10,325 rows). This is application paperwork rather than runtime
 * config: nothing here builds a link. It lives on the server precisely because
 * of that, since the storefront has no use for a table of our commission rates
 * and every byte of public/app.js is served to every visitor.
 *
 * Two traps in that export, both of which bite here:
 *
 * 1. CREATOR PROGRAMMES OFTEN PAY MORE FOR THE SAME SALE. Where an advertiser
 *    runs both a standard and a "- Creator" programme, the Creator one is
 *    frequently the better rate: Wooden Spoon Herbs is 5% standard against 20%
 *    Creator, a fourfold difference for identical traffic. Before applying to
 *    anything, search the export for the maker's domain and take the
 *    best-paying programme rather than the first match.
 * 2. THE PAYOUT LABEL CHANGES WHAT THE RATE MEANS. "Recurring Sales" pays on
 *    repeat orders, "Online Sale" pays once. Tea For Guys runs both at 15%,
 *    which looks like a coin toss and is not: tea is a consumable that people
 *    rebuy, so the recurring programme is worth materially more per customer.
 *
 * `id` is blank where this maker's row was identified by name and rate but the
 * id was not carried over; it is in the export, look it up rather than
 * guessing. A wrong id applies to somebody else's programme.
 *
 * Rates are what the maker published to the marketplace, not a negotiated
 * deal, and they are NOT a coupon. Nothing here entitles the storefront to
 * advertise a discount: see the coupon rule in HLM_DEFAULT_RULES. */
type ImpactProgram = { id: string; label: string; rate: string; note?: string }
export const IMPACT_PROGRAMS: Record<string, ImpactProgram> = {
  "Tea For Guys": {
    id: "40494",
    label: "Recurring Sales",
    rate: "15%",
    note: 'Also runs "Tea For Guys - Product Reviews" (id 44574, Online Sale, 15%). Apply to 40494: same headline rate, but it pays on the repeat orders a tea drinker actually makes. 44574 is a content placement, worth holding as a second programme if they allow both, never instead.',
  },
  "Purest Mushrooms": { id: "", label: "Online Sale", rate: "25%", note: "Highest rate of the seven." },
  "Wooden Spoon Herbs": {
    id: "",
    label: "Online Sale",
    rate: "20%",
    note: 'MUST be the "- Creator" programme. The standard programme is 5% for the same traffic.',
  },
  "Balls Deep Tea Company": { id: "", label: "Online Sale", rate: "15%" },
  "St. Francis Herb Farm": { id: "", label: "Online Sale", rate: "15%" },
  /* The two established tea houses pay what established tea houses pay. Worth
   * having for the shelf, not worth planning revenue on. */
  "Republic of Tea": { id: "", label: "Online Sale", rate: "4%" },
  "Tea Sparrow": { id: "", label: "Online Sale", rate: "5%" },
  /* The two best-paying makers on the list, both 25%. Encha is ceremonial
   * matcha out of Uji; RE Botanicals is a hemp apothecary, which puts them in
   * isCBD() territory and means the Legal Leaf cross-sell tag will render on
   * their cards. */
  "Encha Matcha": { id: "", label: "Online Sale", rate: "25%" },
  "RE Botanicals": {
    id: "",
    label: "Online Sale",
    rate: "25%",
    note: "Their brand leads with a USDA certified-organic claim, which this site removed from its own copy on 2026-08-08. Settle whether an ingested product title counts as the maker's words before their feed goes live.",
  },
  /* Not a new maker: already in SHOPIFY_STORES above, and every click we have
   * sent them so far has gone unattributed while their Awin application sits
   * pending. Attaching attribution to a handoff that already happens is the
   * cheapest revenue on this list. */
  "Charlotte's Web": { id: "44451", label: "Online Sale", rate: "10%", note: "Creator programme. Existing vendor, currently untracked." },
}

const NSS_ORIGIN = "https://www.smokingblends.com"
const NSS_CACHE_KEY = "nss_ids_v1"

const HLM_DEFAULT_RULES = {
  evidenceFloor: "traditional",
  itemsPerRitual: 3,
  preferInStock: true,
  showEvidenceBadges: true,
  crossSellCBD: true,
  goalsEnabled: { calm: true, sleep: true, focus: true, ritual: true },
  /* Mirrors BRAND_AFFILIATES in public/app.js — keep the two in step.
   * Verified at each maker's own checkout 2026-08-08: JACOBKENNEDY is a live
   * coupon ONLY at Natural Smoke Shop. Bear Blend, Puff Herbals, Secret
   * Nature and Soul CBD all reject it, so advertising a percentage for them
   * would promise a discount the checkout refuses. Zero until a maker issues
   * a code that has been re-tested at the till. */
  coupons: {
    "Bear Blend": 0,
    "Puff Herbals": 0,
    "Secret Nature": 0,
    "Soul CBD": 0,
    "Natural Smoke Shop": 10,
    "Charlotte's Web": 0,
    /* impact.com registrations, 2026-08-12. Zero on all seven: any code these
     * programs issue arrives with the acceptance, and an issued code is still
     * not a verified one until it has been applied at that maker's own
     * checkout. */
    "Tea For Guys": 0,
    "Purest Mushrooms": 0,
    "Wooden Spoon Herbs": 0,
    "Balls Deep Tea Company": 0,
    "St. Francis Herb Farm": 0,
    "Republic of Tea": 0,
    "Tea Sparrow": 0,
    "Encha Matcha": 0,
    "RE Botanicals": 0,
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
/* v4 -> v5 on 2026-08-12: Rishi Tea left the roster, and a warm v4 key would
 * have gone on serving their products for up to six hours after the deploy that
 * removed them, on a shelf whose app.js no longer knew their shipping, their
 * checkout route or their coupon. Dropping a vendor changes this payload just
 * as surely as adding a field does. */
const INVENTORY_KEY = "hlm_live_v5"
/* TTL 6h, but the refresh-inventory cron rebuilds every 4h, so in normal
 * operation the key NEVER expires and no visitor ever pays for a scrape.
 * The TTL is the safety net for when the cron is down, not the schedule. */
const INVENTORY_TTL = 21600

/* The full scrape: every non-pending Shopify feed + the Secret Nature lab page, mapped,
 * COAs joined, written to KV. This is the expensive path (~10-20s) and it is
 * meant to run from the CRON, in the background, where nobody is waiting. */
export async function buildInventory(): Promise<any[]> {
  let out: any[] = []
  try {
    /* Filter to the live stores ONCE and index everything off that same array.
     * batches[i] is matched back to its store by position, so filtering inside
     * the loop instead would slide every store one place along and file one
     * maker's products under another maker's name. */
    const live = SHOPIFY_STORES.filter((s) => !s.pending)
    const held = SHOPIFY_STORES.filter((s) => s.pending).map((s) => s.vendor)
    if (held.length) {
      console.log(`[inventory] pending, not scraped: ${held.join(", ")} (see ShopifyStore.pending)`)
    }
    const [batches, snCoas] = await Promise.all([
      Promise.all(live.map((s) => fetchStoreProducts(s))),
      fetchSecretNatureCoas().catch(() => new Map<string, SnDoc[]>()),
    ])
    for (let i = 0; i < batches.length; i++) {
      out = out.concat(mapShopify(live[i], batches[i]))
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
 * the feed just comes back smaller than the shop and nothing says so. A former
 * vendor with 289 products was the first to expose it, and the pending makers
 * make it live again: Republic of Tea alone lists well past 250. Page until a
 * short page comes back.
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

/* =========================================================================
 * SITE STATS — the numbers behind /admin.
 *
 * AGGREGATED IN SQL, NOT IN THE BROWSER
 *
 * The raw table is every event on the site. Shipping it to the client and
 * counting there would mean the admin page downloads the whole log, which is
 * slow on a season of data and a far bigger thing to leak if the password
 * ever escaped. The browser only ever receives totals.
 *
 * SESSIONS, NOT EVENTS, IN EVERY FUNNEL
 *
 * A funnel counted in events lies. One person opening the ritual builder,
 * changing six goals and adding nothing looks like six steps of enthusiasm.
 * Every step below counts DISTINCT sid, so a visit contributes at most one
 * to each step and a drop between steps is a drop in people.
 *
 * The consequence when reading it: these are per-tab sessions, so one person
 * across two visits is two sessions. Right for shape, wrong for "how many
 * humans", and nothing here claims the latter.
 * ====================================================================== */
async function siteStats(days: number): Promise<any> {
  /* Clamped: an unbounded window is a full table scan on a shared Neon
   * instance, and the admin page only offers these four. */
  const d = [1, 7, 30, 90].indexOf(days) === -1 ? 7 : days
  const since = Date.now() - d * 864e5

  const q = async (text: any): Promise<any[]> => {
    const r: any = await db.execute(text)
    return Array.isArray(r) ? r : r?.rows ?? []
  }
  const n = (v: any) => Number(v ?? 0)

  try {
    const [totals, byName, topProducts, topVendors, topPages, searches, zero, funnel] =
      await Promise.all([
        q(sql`SELECT count(DISTINCT sid) AS sessions,
                     count(*) FILTER (WHERE name = 'page_view') AS views,
                     count(*) FILTER (WHERE name = 'outbound_click') AS outbound,
                     count(DISTINCT sid) FILTER (WHERE name = 'outbound_click') AS outbound_sessions,
                     count(*) FILTER (WHERE name = 'cart_add') AS carted
              FROM site_events WHERE ts >= ${since}`),

        q(sql`SELECT name, count(*) AS c, count(DISTINCT sid) AS s
              FROM site_events WHERE ts >= ${since}
              GROUP BY name ORDER BY c DESC`),

        /* Ranked by the furthest thing we can observe, never by views: we do
         * not take the order, so "popular" here means most clicked out. */
        q(sql`SELECT product, max(vendor) AS vendor,
                     count(*) FILTER (WHERE name = 'outbound_click') AS clicks,
                     count(*) FILTER (WHERE name = 'cart_add') AS carted
              FROM site_events
              WHERE ts >= ${since} AND product <> ''
              GROUP BY product
              HAVING count(*) FILTER (WHERE name IN ('outbound_click','cart_add')) > 0
              ORDER BY clicks DESC, carted DESC LIMIT 25`),

        q(sql`SELECT vendor,
                     count(*) FILTER (WHERE name = 'outbound_click') AS clicks,
                     count(DISTINCT sid) AS sessions
              FROM site_events
              WHERE ts >= ${since} AND vendor <> ''
              GROUP BY vendor ORDER BY clicks DESC LIMIT 25`),

        q(sql`SELECT page, count(*) AS views, count(DISTINCT sid) AS sessions
              FROM site_events
              WHERE ts >= ${since} AND name = 'page_view'
              GROUP BY page ORDER BY views DESC LIMIT 15`),

        q(sql`SELECT meta AS term, count(*) AS c FROM site_events
              WHERE ts >= ${since} AND name = 'search' AND meta <> ''
              GROUP BY meta ORDER BY c DESC LIMIT 25`),

        /* The most actionable list on the page: searched for, found nothing.
         * Things people came here wanting, in their own words, that the
         * shelf does not carry. */
        q(sql`SELECT meta AS term, count(*) AS c FROM site_events
              WHERE ts >= ${since} AND name = 'search_zero' AND meta <> ''
              GROUP BY meta ORDER BY c DESC LIMIT 25`),

        q(sql`SELECT name, count(DISTINCT sid) AS s FROM site_events
              WHERE ts >= ${since}
                AND name IN ('page_view','card_open','cart_add','cart_open',
                             'checkout_click','outbound_click',
                             'ritual_open','ritual_goal','ritual_result','ritual_click')
              GROUP BY name`),
      ])

    const step = (k: string) => n(funnel.find((r: any) => r.name === k)?.s)
    const t = totals[0] || {}

    return {
      ok: true,
      days: d,
      totals: {
        sessions: n(t.sessions), views: n(t.views), outbound: n(t.outbound),
        outboundSessions: n(t.outbound_sessions), carted: n(t.carted),
      },
      byName: byName.map((r: any) => ({ name: r.name, c: n(r.c), s: n(r.s) })),
      topProducts: topProducts.map((r: any) => ({
        product: r.product, vendor: r.vendor, clicks: n(r.clicks), carted: n(r.carted),
      })),
      topVendors: topVendors.map((r: any) => ({
        vendor: r.vendor, clicks: n(r.clicks), sessions: n(r.sessions),
      })),
      topPages: topPages.map((r: any) => ({ page: r.page || "(home)", views: n(r.views), sessions: n(r.sessions) })),
      searches: searches.map((r: any) => ({ term: r.term, c: n(r.c) })),
      zeroSearches: zero.map((r: any) => ({ term: r.term, c: n(r.c) })),
      funnels: [
        {
          key: "shop",
          title: "Shelf to hand-off",
          note: "Sessions reaching each step. Everyone who arrives is the first bar.",
          steps: [
            { label: "arrived", sessions: step("page_view") },
            { label: "opened a card", sessions: step("card_open") },
            { label: "added to cart", sessions: step("cart_add") },
            { label: "opened the cart", sessions: step("cart_open") },
            { label: "left for a maker", sessions: step("checkout_click") + step("outbound_click") },
          ],
        },
        {
          key: "ritual",
          title: "Build Your Ritual",
          note: "Where the builder loses people. A wide gap between goal and result means the matrix is coming back empty.",
          steps: [
            { label: "opened", sessions: step("ritual_open") },
            { label: "picked a goal", sessions: step("ritual_goal") },
            { label: "saw a bundle", sessions: step("ritual_result") },
            { label: "took something", sessions: step("ritual_click") },
          ],
        },
      ],
    }
  } catch (e: any) {
    /* Surfaced rather than swallowed: the reader is the owner, and "the
     * table does not exist yet" needs a different reaction from "the query
     * is wrong". The sink creates the table on its first write, so an empty
     * site legitimately has no table until somebody visits. */
    return { ok: false, error: String(e?.message || e), days: d }
  }
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
  hlmSiteStats: (a) => siteStats(Number((a && a[1]) || 7)),
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
