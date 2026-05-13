// Shared Postgres pool. Lazy-initialised so the module imports cleanly even
// when POSTGRES_URL isn't set — library endpoints check `HAS_DB` before
// touching the pool and return 503 with a setup hint, matching the
// ANTHROPIC_API_KEY pattern used by the analyze handler.
//
// Works with any Postgres-compatible connection string: Vercel Postgres,
// Neon, Supabase, plain `postgres://` to a local server.

import pg from "pg";

const url = process.env.POSTGRES_URL;
export const HAS_DB = !!url;

let pool = null;

export function getPool() {
  if (!HAS_DB) {
    throw new Error(
      "POSTGRES_URL not configured. Add it to .env (Vercel Postgres / Neon / Supabase / local).",
    );
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: url,
      // Conservative caps for serverless cold paths and local dev. Vercel
      // serverless functions hold a connection per concurrent request; a
      // small pool keeps the server from holding too many.
      max: 5,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}
