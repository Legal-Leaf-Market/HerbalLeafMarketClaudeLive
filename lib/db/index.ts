import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema"

function createDatabase() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL must be configured to use database-backed API features.")
  }
  return drizzle(neon(connectionString), { schema })
}

type Database = ReturnType<typeof createDatabase>
let database: Database | undefined

// Next.js imports route modules during builds. Connect only when a request uses db.
// Keep the existing db API so callers do not need to change.
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const instance = (database ??= createDatabase())
    const value = Reflect.get(instance, property, instance)
    return typeof value === "function" ? value.bind(instance) : value
  },
})

export { schema }
