import type { Actor } from "@/lib/auth/core";
import { getDb } from "@/lib/db";
import { AuthError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { requirePermission } from "./common";

const FINANCIAL_KEYS = ["contract_amount_cents", "margin_cents", "margin_pct"];

/** Remove customer-price fields from log entries for viewers without financial access. */
function redact(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !FINANCIAL_KEYS.includes(k)));
  return Object.keys(out).length ? out : null;
}

export interface AuditRow {
  id: number;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  job_id: string | null;
  job_number: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

export async function listAudit(actor: Actor | null, opts: { jobId?: string; entityId?: string; limit?: number } = {}) {
  requirePermission(actor, "audit.view");
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.jobId) {
    params.push(opts.jobId);
    where.push(`a.job_id = $${params.length}`);
  }
  if (opts.entityId) {
    params.push(opts.entityId);
    where.push(`a.entity_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 200, 1000));
  const { rows } = await db.query<AuditRow>(
    `select a.id, u.name as actor_name, a.actor_role, a.action, a.entity_type, a.entity_id, a.job_id,
            j.job_number, a.before, a.after, a.created_at
       from audit_log a left join users u on u.id = a.actor_id left join jobs j on j.id = a.job_id
      ${where.length ? "where " + where.join(" and ") : ""}
      order by a.id desc limit $${params.length}`,
    params,
  );
  if (can(actor.role, "jobs.view_financials")) return rows;
  return rows.map((r) => ({ ...r, before: redact(r.before), after: redact(r.after) }));
}

export async function listNotifications(actor: Actor | null, limit = 50) {
  if (!actor) throw new AuthError();
  const db = await getDb();
  const { rows } = await db.query<{ id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }>(
    "select id, title, body, link, read_at, created_at from notifications where user_id = $1 order by created_at desc limit $2",
    [actor.userId, limit],
  );
  return rows;
}

export async function unreadCount(actor: Actor | null) {
  if (!actor) return 0;
  const db = await getDb();
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from notifications where user_id = $1 and read_at is null",
    [actor.userId],
  );
  return rows[0].n;
}

export async function markAllRead(actor: Actor | null) {
  if (!actor) throw new AuthError();
  const db = await getDb();
  await db.query("update notifications set read_at = now() where user_id = $1 and read_at is null", [actor.userId]);
}

export async function listOutbox(actor: Actor | null) {
  requirePermission(actor, "integrations.view");
  const db = await getDb();
  const { rows } = await db.query<{ id: string; channel: string; recipient: string | null; payload: Record<string, unknown>; status: string; created_at: string }>(
    "select id, channel, recipient, payload, status, created_at from outbox order by created_at desc limit 100",
  );
  return rows;
}
