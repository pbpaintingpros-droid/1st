import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { requireSubPage } from "@/lib/auth/session";
import { unreadCount } from "@/lib/services/activity";

export default async function CrewLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireSubPage();
  const unread = await unreadCount(actor);
  return (
    <div className="min-h-dvh pb-10">
      <header className="sticky top-0 z-20 bg-brand-900 text-white shadow">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/crew" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-black">PB</span>
            Crew Portal
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link href="/crew/notifications" className="relative rounded-md px-2 py-1 text-brand-100 hover:bg-white/10">
              Alerts{unread > 0 && <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-brand-900">{unread}</span>}
            </Link>
            <form action={logoutAction}>
              <button className="rounded-md px-2 py-1 text-brand-100 hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>
    </div>
  );
}
