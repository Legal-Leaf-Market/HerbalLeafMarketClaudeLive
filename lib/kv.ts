import { db } from "./db"
import { kv } from "./db/schema"
import { eq, sql } from "drizzle-orm"

// Postgres-backed replacement for Cloudflare KV.
// TTL is stored as an absolute expiry (epoch ms); reads treat expired rows as absent.

export async function kvGet(key: string): Promise<string | null> {
  const rows = await db
    .select({ v: kv.v, expiresAt: kv.expiresAt })
    .from(kv)
    .where(eq(kv.k, key))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.expiresAt != null && row.expiresAt < Date.now()) {
    // Lazily clean up expired entries.
    kvDel(key).catch(() => {})
    return null
  }
  return row.v
}

export async function kvPut(key: string, val: string, ttlSeconds?: number): Promise<void> {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  await db
    .insert(kv)
    .values({ k: key, v: val, expiresAt })
    .onConflictDoUpdate({
      target: kv.k,
      set: { v: sql`excluded.v`, expiresAt: sql`excluded.expires_at` },
    })
}

export async function kvDel(key: string): Promise<void> {
  await db.delete(kv).where(eq(kv.k, key))
}
