import { config } from "dotenv";
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

const { Pool } = pg;

// A local recovery target is deliberately separate from .env so switching away
// from an unavailable provider is reversible and never overwrites its URL.
// 2026-09-22: override disabled — the Supabase org is quota-paused and its
// pooler answers "tenant not found", which silently broke every login. Running
// on .env (Neon) until the project is resumed; re-enable this line to switch back.
// config({ path: ".env.supabase", override: true });
void config; // keep the dotenv import live for the commented switch above

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Use PostgreSQL's normal TCP driver instead of Neon's WebSocket protocol.
 * QuantEdge can now use Neon, Supabase, Railway, or local Postgres by replacing
 * DATABASE_URL — provider failures no longer lock the whole terminal to Neon.
 */
/**
 * Pool size is set explicitly, not left to the driver default.
 *
 * `pg` defaults to max 10, and this single pool serves THREE consumers at once:
 * ordinary request handlers, the connect-pg-simple session store (which shares
 * this pool deliberately — see replitAuth.getSession), and eight scheduled
 * background jobs. Under one user that is invisible. With several people on the
 * site at the same time, a scanner sweep can hold every client and normal page
 * requests queue behind it until they time out — which presents as the site
 * being down, not as a pool limit.
 *
 * DB_POOL_MAX lets the deployment match its provider's ceiling. The default of
 * 12 sits under Supabase's pooler cap of 15 with headroom for the one extra
 * connection the scheduler leader-lock holds open (see scheduler-lock.ts).
 *
 * Timeouts matter as much as the count: without them a wedged query holds its
 * client forever and the pool never recovers on its own.
 */
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 12);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(POOL_MAX) && POOL_MAX > 0 ? POOL_MAX : 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? undefined
    : { rejectUnauthorized: false },
});

// A pool error with no listener crashes the process on Node.
pool.on('error', (err) => {
  console.error('[DB] idle client error:', err?.message ?? err);
});
export const db = drizzle({ client: pool, schema });
