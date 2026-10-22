import { getDb, migrate } from "../src/lib/db";
import { SAMPLE_LOGINS, SAMPLE_PASSWORD, seed } from "../src/lib/seed";

(async () => {
  if (process.env.DATABASE_URL && process.argv[2] !== "--i-understand-this-adds-sample-data") {
    console.error(
      "DATABASE_URL is set. Refusing to load SAMPLE data into a real database.\n" +
        "If this is an empty test database, re-run: npm run db:seed -- --i-understand-this-adds-sample-data",
    );
    process.exit(1);
  }
  const db = await getDb();
  await migrate(db);
  const existing = await db.query<{ n: number }>("select count(*)::int as n from users");
  if (existing.rows[0].n > 0) {
    console.log("Database already has users — skipping seed. Run `npm run db:reset` to start over (local only).");
  } else {
    await seed(db);
    console.log("Sample data loaded. Logins (password for all: " + SAMPLE_PASSWORD + "):");
    for (const [k, v] of Object.entries(SAMPLE_LOGINS)) console.log(`  ${k.padEnd(12)} ${v}`);
  }
  await db.close();
})();
