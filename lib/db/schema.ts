import { pgTable, text, bigint, doublePrecision, bigserial, index } from "drizzle-orm/pg-core"

// Email mailing list + each member's saved "garden" (JSON blobs kept as text,
// exactly matching the original Cloudflare D1 shape).
export const members = pgTable("members", {
  email: text("email").primaryKey(),
  name: text("name").notNull().default(""),
  joined: bigint("joined", { mode: "number" }).notNull().default(0),
  garden: text("garden").notNull().default("{}"),
  notified: text("notified").notNull().default("{}"),
  consent: text("consent").notNull().default("no"),
  unsubscribed: text("unsubscribed").notNull().default(""),
  lastEmail: bigint("last_email", { mode: "number" }).notNull().default(0),
})

// Outbound click analytics.
export const clicks = pgTable("clicks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: bigint("ts", { mode: "number" }).notNull().default(0),
  type: text("type").notNull().default(""),
  vendor: text("vendor").notNull().default(""),
  product: text("product").notNull().default(""),
  price: doublePrecision("price").notNull().default(0),
  category: text("category").notNull().default(""),
  page: text("page").notNull().default(""),
  device: text("device").notNull().default(""),
  email: text("email").notNull().default(""),
  ref: text("ref").notNull().default(""),
})

// Key/value store. Replaces Cloudflare KV:
//  - persistent config: "HLM_RULES", "HLM_MATRIX_OV" (expires_at = null)
//  - TTL cache: "hlm_live_v3" (inventory), "nss_ids_v1" (expires_at = epoch ms)
export const kv = pgTable("kv", {
  k: text("k").primaryKey(),
  v: text("v").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }),
})

/* =========================================================================
 * SITE EVENTS — what a visit actually did, in order.
 *
 * WHY THIS EXISTS ALONGSIDE `clicks`
 *
 * `clicks` is the money log: one row per hand-off, kept for the weekly click
 * report and for partner negotiation. It answers "what did people leave for".
 * It cannot answer "where did people give up", and the reason is not that it
 * lacks columns, it is that it has no way to tell two visits apart. Four
 * hundred ritual builders opened and twelve baskets filled is a fact about
 * two numbers; whether they were the same four hundred people is a fact
 * about ORDER, and only a session id can carry it.
 *
 * So this table is rows with a session and a timestamp, and every funnel on
 * the admin page counts DISTINCT sid. One visit contributes at most one to
 * each step, and a drop between steps is a drop in PEOPLE.
 *
 * The consequence to remember when reading it: `sid` is per TAB, so one
 * person coming back tomorrow is two sessions. Good for shape, wrong for
 * "how many humans", and nothing on the admin page claims the latter.
 *
 * WHAT IS DELIBERATELY NOT IN HERE
 *
 * No IP, no user agent, no cookie, no email, no account. `sid` is a random
 * value in sessionStorage that dies when the tab closes, so it stitches one
 * visit together and cannot follow anybody between visits or across devices.
 * That is the least identifying thing that still makes a funnel possible,
 * and it is a ceiling rather than a starting point: this is a shop, and the
 * analytics should not know more about a visitor than the shopkeeper would.
 *
 * Note that `clicks` DOES carry an email (Garden members identify
 * themselves when they save). This table must never be joined to it on
 * anything that would put a name against a session.
 * ====================================================================== */
export const siteEvents = pgTable(
  "site_events",
  {
    id: text("id").primaryKey(),
    // epoch ms, matching `clicks.ts` rather than a timestamptz, so the two
    // tables can be read against the same window without a cast
    ts: bigint("ts", { mode: "number" }).notNull().default(0),
    /** Per-tab random id. Not a cookie, not stable across visits. */
    sid: text("sid").notNull().default(""),
    /** Event name. The allow-list lives in app/api/events/route.ts. */
    name: text("name").notNull().default(""),
    /** Page it happened on. */
    page: text("page").notNull().default(""),
    product: text("product").notNull().default(""),
    vendor: text("vendor").notNull().default(""),
    cat: text("cat").notNull().default(""),
    /** Small extras: a search term, a goal, a price band. */
    meta: text("meta").notNull().default(""),
  },
  (t) => [
    index("site_events_ts_idx").on(t.ts),
    index("site_events_name_ts_idx").on(t.name, t.ts),
    index("site_events_sid_idx").on(t.sid),
  ],
)
