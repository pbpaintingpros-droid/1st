import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { SampleBanner } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { unreadCount } from "@/lib/services/activity";
import { pendingApprovals } from "@/lib/services/offers";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffPage();
  const [unread, approvals] = await Promise.all([unreadCount(actor), pendingApprovals(actor)]);
  const nav = [
    { href: "/hub", label: "Jobs" },
    { href: "/hub/calendar", label: "Calendar" },
    { href: "/hub/subs", label: "Subcontractors" },
    { href: "/hub/approvals", label: "Approvals", count: approvals.length },
    { href: "/hub/notifications", label: "Notifications", count: unread },
    { href: "/hub/activity", label: "Activity log" },
    { href: "/hub/import", label: "Import" },
    { href: "/hub/integrations", label: "Integrations" },
    ...(can(actor.role, "settings.edit") ? [{ href: "/hub/settings", label: "Settings" }] : []),
  ];
  return (
    <div className="min-h-dvh">
      {!process.env.DATABASE_URL && <SampleBanner />}
      <header className="sticky top-0 z-20 bg-brand-900 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/hub" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-black">PB</span>
            <span>Production Hub</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-brand-100 sm:inline">
              {actor.name} · <span className="capitalize">{actor.role}</span>
            </span>
            <form action={logoutAction}>
              <button className="rounded-md px-2 py-1 text-brand-100 hover:bg-white/10 hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto max-w-7xl overflow-x-auto px-2" aria-label="Main">
          <ul className="flex gap-1 pb-1.5 text-sm whitespace-nowrap">
            {nav.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-brand-100 hover:bg-white/10 hover:text-white">
                  {n.label}
                  {!!n.count && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-brand-900">{n.count}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:py-6">{children}</main>
    </div>
  );
}
