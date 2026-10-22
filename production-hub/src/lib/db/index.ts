import fs from "node:fs";
import path from "node:path";

/**
 * Minimal database interface shared by real Postgres (Supabase) and the
 * built-in local database (PGlite). All queries are parameterized.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement script with no parameters (migrations only). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function createPgDb(url: string): Promise<Db> {
  const { Pool, types } = await import("pg");
  // Return bigint/int8 (money in cents) and dates as plain values we control.
  types.setTypeParser(20, (v) => Number(v));
  types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD'
  types.setTypeParser(1700, (v) => Number(v));
  const pool = new Pool({ connectionString: url, max: 5 });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          query: (s, p) => client.query(s, p as unknown[]) as never,
          exec: async (s) => {
            await client.query(s);
          },
        });
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const parsers = {
    [types.INT8]: (v: string) => Number(v),
    [types.DATE]: (v: string) => v,
    [types.NUMERIC]: (v: string) => Number(v),
  };
  const pg = new PGlite({ dataDir, parsers });
  await pg.waitReady;
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    exec: async (sql) => {
      await pg.exec(sql);
    },
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({
          query: (s, p) => tx.query(s, p) as never,
          exec: async (s) => {
            await tx.exec(s);
          },
        }),
      ),
    close: () => pg.close(),
  };
}

export async function migrate(db: Db): Promise<string[]> {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name),
  );
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}

// Kept on globalThis so dev-server hot reloads reuse one connection.
const g = globalThis as unknown as { __pbHubDb?: Promise<Db> | null };

/** Override the shared database (used by tests). */
export function setDb(db: Db | null) {
  g.__pbHubDb = db ? Promise.resolve(db) : null;
}

export function getDb(): Promise<Db> {
  if (!g.__pbHubDb) {
    g.__pbHubDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) return createPgDb(url);
      const dir = path.join(process.cwd(), ".data", "pglite");
      fs.mkdirSync(dir, { recursive: true });
      const db = await createPgliteDb(dir);
      await migrate(db);
      return db;
    })();
  }
  return g.__pbHubDb;
}
