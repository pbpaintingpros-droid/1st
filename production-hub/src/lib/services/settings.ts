import type { Actor } from "@/lib/auth/core";
import { getDb, type Queryable } from "@/lib/db";
import { audit, requirePermission } from "./common";
import { parseMatchingRules, type MatchingRules } from "./rules";

export async function getMatchingRules(q?: Queryable): Promise<MatchingRules> {
  const db = q ?? (await getDb());
  const { rows } = await db.query<{ value: unknown }>("select value from settings where key = 'matching_rules'");
  return parseMatchingRules(rows[0]?.value);
}

export async function saveMatchingRules(actor: Actor | null, input: Partial<MatchingRules>) {
  requirePermission(actor, "settings.edit");
  const rules = parseMatchingRules(input);
  const before = await getMatchingRules();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into settings (key, value, updated_by) values ('matching_rules', $1, $2)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [JSON.stringify(rules), actor.userId],
    );
    await audit(tx, actor, { action: "settings.matching_rules_changed", entityType: "settings", entityId: "matching_rules", before, after: rules });
  });
  return rules;
}
