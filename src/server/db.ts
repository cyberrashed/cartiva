import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Serverless functions each hold their own pool, so hosted deployments keep it small
// and should point DATABASE_URL at the provider's pooled endpoint (for Neon, the
// "-pooler" host). Override with DATABASE_POOL_MAX when needed.
const poolMax = Number(process.env.DATABASE_POOL_MAX) || (process.env.VERCEL ? 3 : 10);

const globalDatabase = globalThis as unknown as { cartivaPool?: Pool };
export const pool = globalDatabase.cartivaPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
if (process.env.NODE_ENV !== "production") globalDatabase.cartivaPool = pool;
export const db = drizzle(pool, { schema });
