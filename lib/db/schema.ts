import { pgTable, text, bigint, doublePrecision, bigserial } from "drizzle-orm/pg-core"

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
