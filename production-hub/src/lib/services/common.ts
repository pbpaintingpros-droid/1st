import type { Actor } from "@/lib/auth/core";
import type { Queryable } from "@/lib/db";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";

export function requirePermission(actor: Actor | null, permission: Permission): asserts actor is Actor {
  if (!actor) throw new AuthError();
  if (!can(actor.role, permission)) throw new ForbiddenError();
}

export function requireStaff(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new AuthError();
  if (actor.role !== "owner" && actor.role !== "coordinator") throw new ForbiddenError();
}

export function requireSub(actor: Actor | null): asserts actor is Actor & { subcontractorId: string } {
  if (!actor) throw new AuthError();
  if (actor.role !== "sub" || !actor.subcontractorId) throw new ForbiddenError();
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  jobId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only. Call inside the same transaction as the change it records. */
export async function audit(tx: Queryable, actor: Actor | null, e: AuditEntry) {
  await tx.query(
    `insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, job_id, before, after)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      actor?.userId ?? null,
      actor?.role ?? "system",
      e.action,
      e.entityType,
      e.entityId,
      e.jobId ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
    ],
  );
}

/** In-app notifications only. Nothing here sends SMS or email. */
export async function notifyStaff(tx: Queryable, title: string, body: string, link: string, ownerOnly = false) {
  await tx.query(
    `insert into notifications (user_id, title, body, link)
     select id, $1, $2, $3 from users where active and role = any($4)`,
    [title, body, link, ownerOnly ? ["owner"] : ["owner", "coordinator"]],
  );
}

export async function notifySub(tx: Queryable, subcontractorId: string, title: string, body: string, link: string) {
  await tx.query(
    `insert into notifications (user_id, title, body, link)
     select id, $1, $2, $3 from users where active and role = 'sub' and subcontractor_id = $4`,
    [title, body, link, subcontractorId],
  );
}

/** Queue an outbound message. It is NOT sent — an owner must approve it first. */
export async function queueOutbound(
  tx: Queryable,
  actor: Actor,
  channel: "sms" | "email",
  recipient: string | null,
  payload: Record<string, unknown>,
) {
  if (!recipient) return;
  await tx.query(`insert into outbox (channel, recipient, payload, created_by) values ($1,$2,$3,$4)`, [
    channel,
    recipient,
    JSON.stringify(payload),
    actor.userId,
  ]);
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
