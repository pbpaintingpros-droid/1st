/**
 * Role-based permissions. This is the ONE place that decides who can do what.
 * Every server action and data read calls `can()` / `requirePermission()`.
 *
 * To change what Santiago (coordinator) can do, edit the coordinator list below.
 */
export type Role = "owner" | "coordinator" | "sub";

export const PERMISSIONS = [
  "jobs.view",
  "jobs.edit",
  "jobs.view_financials", // customer contract amount, PB target payout, margin
  "subs.view",
  "subs.edit",
  "subs.documents",
  "offers.create",
  "offers.send", // sending an offer commits PB to a price
  "offers.send_above_target", // send an offer above the job's target payout
  "offers.withdraw",
  "offers.award",
  "counteroffers.recommend",
  "counteroffers.approve",
  "schedule.edit",
  "audit.view",
  "settings.edit",
  "users.manage",
  "import.run",
  "integrations.view",
  "crew.portal", // subcontractor-only area
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS.filter((p) => p !== "crew.portal"),
  coordinator: [
    "jobs.view",
    "jobs.edit",
    "subs.view",
    "subs.edit",
    "subs.documents",
    "offers.create",
    "offers.send", // only at or below target payout (see offers.send_above_target)
    "offers.withdraw",
    "offers.award",
    "counteroffers.recommend",
    "schedule.edit",
    "audit.view",
    "import.run",
    "integrations.view",
  ],
  sub: ["crew.portal"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
