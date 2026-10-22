import { getDb, migrate } from "../src/lib/db";

(async () => {
  const db = await getDb();
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  await db.close();
})();
