// Idempotent migration runner: applies every .sql under db/migrations/ in
// lexicographic order. Tracks applied filenames in a `schema_migrations`
// table so reruns are safe. Designed to be invoked from `npm run migrate`
// locally and from the Vercel build step.
//
// Requires POSTGRES_URL in the environment. Exits with a clear message if
// it's missing — useful for the first-time-deploy moment when the user
// forgot to provision a database.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error(
      "POSTGRES_URL not set. Provision a Postgres instance (Vercel Postgres, " +
        "Neon, Supabase, or local) and add the connection string to .env.",
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await client.query("SELECT filename FROM schema_migrations")).rows.map(
      (r) => r.filename,
    ),
  );

  let ranAny = false;
  for (const filename of entries) {
    if (applied.has(filename)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    console.log(`→ applying ${filename}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(filename) VALUES ($1)",
        [filename],
      );
      await client.query("COMMIT");
      ranAny = true;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ ${filename} failed:`, err.message);
      process.exit(2);
    }
  }

  await client.end();
  console.log(ranAny ? "✓ migrations applied" : "✓ already up to date");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
