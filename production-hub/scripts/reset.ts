import fs from "node:fs";
import path from "node:path";

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL is set — db:reset only works on the built-in local database. Nothing was deleted.");
  process.exit(1);
}
const dir = path.join(process.cwd(), ".data");
fs.rmSync(dir, { recursive: true, force: true });
console.log("Local sample database deleted. Run `npm run db:seed` to reload sample data.");
