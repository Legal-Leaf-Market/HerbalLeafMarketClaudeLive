import { pgTable, text, bigint, doublePrecision, bigserial, timestamp, index } from "drizzle-orm/pg-core"

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

/**
 * What visitors actually do here. Ported from Kawaii Katz, IDENTICAL shape to
 * that site's `site_events`, so two sites sharing a database later need no
 * reconciliation. Same reason `kv` matches across the sister sites.
 *
 * THIS REPLACES A PIPELINE THAT HAS BEEN DEAD SINCE THE VERCEL MIGRATION.
 * `hlmTrack()` in public/app.js returns immediately unless `google.script.run`
 * exists, which it does only inside a Google Apps Script web app. Every call
 * site in app.js has been a no-op since, and the `clicks` table above has had
 * nothing writing to it. The failure was silent and total: an empty analytics
 * table looks exactly like a site nobody visits.
 *
 * `clicks` is left alone rather than migrated. It is the older single-purpose
 * outbound log and admin.html's "Clicks (7d)" tile still reads it; deleting a
 * table to tidy up is not worth the risk on a live database. Nothing new writes
 * to it.
 *
 * `sid` is a random per-tab value from sessionStorage: no IP, no cookie, no
 * fingerprint. It exists so a funnel can tell one visit's steps from another's
 * and for nothing else.
 */
export const siteEvents = pgTable(
  "site_events",
  {
    id: text("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    sid: text("sid").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    productId: text("product_id"),
    vendor: text("vendor"),
    cat: text("cat"),
    meta: text("meta"),
  },
  (t) => [
    index("site_events_ts_idx").on(t.ts),
    index("site_events_name_ts_idx").on(t.name, t.ts),
    index("site_events_sid_idx").on(t.sid),
    index("site_events_product_idx").on(t.productId),
  ]
)
