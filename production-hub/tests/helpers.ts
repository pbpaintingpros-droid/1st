import type { Actor } from "@/lib/auth/core";
import { createPgliteDb, migrate, setDb, type Db } from "@/lib/db";
import { seed } from "@/lib/seed";

export type Seeded = Awaited<ReturnType<typeof seed>> & {
  db: Db;
  coordinator: Actor;
  subA: Actor; // Coastline
  subB: Actor; // Mesa
  subC: Actor; // Harbor
};

/** Fresh in-memory Postgres with the real schema + sample data. */
export async function freshDb(): Promise<Seeded> {
  const db = await createPgliteDb();
  await migrate(db);
  setDb(db);
  const s = await seed(db);
  const user = async (email: string): Promise<Actor> => {
    const { rows } = await db.query<{ id: string; role: Actor["role"]; name: string; subcontractor_id: string | null }>(
      "select id, role, name, subcontractor_id from users where email = $1",
      [email],
    );
    return { userId: rows[0].id, role: rows[0].role, name: rows[0].name, email, subcontractorId: rows[0].subcontractor_id };
  };
  return {
    ...s,
    db,
    coordinator: await user("coordinator@sample.pbhub.test"),
    subA: await user("crew@coastline-sample.test"),
    subB: await user("crew@mesa-sample.test"),
    subC: await user("crew@harbor-sample.test"),
  };
}

export async function offerId(db: Db, jobId: string, subId: string) {
  const { rows } = await db.query<{ id: string }>("select id from offers where job_id = $1 and subcontractor_id = $2", [jobId, subId]);
  return rows[0]?.id;
}
