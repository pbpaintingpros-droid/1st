import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { hashPassword, verifyPassword } from "./password";

export interface Actor {
  userId: string;
  role: Role;
  name: string;
  email: string;
  /** Set only for subcontractor logins. */
  subcontractorId: string | null;
}

export const SESSION_DAYS = 14;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Used so a login for an unknown email takes as long as a real one.
let dummyHash: Promise<string> | null = null;

export type LoginResult =
  | { ok: true; token: string; actor: Actor }
  | { ok: false; reason: "invalid" | "locked" };

export async function login(db: Queryable, email: string, password: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await db.query<{
    id: string;
    role: Role;
    name: string;
    email: string;
    subcontractor_id: string | null;
    password_hash: string;
    active: boolean;
    failed_logins: number;
    locked_until: string | null;
  }>("select * from users where email = $1", [normalized]);
  const user = rows[0];

  if (!user || !user.active) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    return { ok: false, reason: "invalid" };
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { ok: false, reason: "locked" };
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const failed = user.failed_logins + 1;
    if (failed >= MAX_FAILED) {
      // lock the account for a while and start counting again afterwards
      await db.query(
        `update users set failed_logins = 0, locked_until = now() + interval '${LOCK_MINUTES} minutes' where id = $1`,
        [user.id],
      );
      return { ok: false, reason: "locked" };
    }
    await db.query("update users set failed_logins = $2 where id = $1", [user.id, failed]);
    return { ok: false, reason: "invalid" };
  }

  await db.query("update users set failed_logins = 0, locked_until = null where id = $1", [user.id]);
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [hashToken(token), user.id],
  );
  return {
    ok: true,
    token,
    actor: {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      subcontractorId: user.subcontractor_id,
    },
  };
}

export async function actorFromToken(db: Queryable, token: string | undefined | null): Promise<Actor | null> {
  if (!token) return null;
  const { rows } = await db.query<{
    id: string;
    role: Role;
    name: string;
    email: string;
    subcontractor_id: string | null;
  }>(
    `select u.id, u.role, u.name, u.email, u.subcontractor_id
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`,
    [hashToken(token)],
  );
  const u = rows[0];
  if (!u) return null;
  return { userId: u.id, role: u.role, name: u.name, email: u.email, subcontractorId: u.subcontractor_id };
}

export async function logout(db: Queryable, token: string) {
  await db.query("delete from sessions where token_hash = $1", [hashToken(token)]);
}
