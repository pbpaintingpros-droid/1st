import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { calendarEntries } from "@/lib/services/jobs";

export const metadata = { title: "Calendar" };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const COLORS = ["bg-sky-100 text-sky-900 border-sky-300", "bg-emerald-100 text-emerald-900 border-emerald-300", "bg-violet-100 text-violet-900 border-violet-300", "bg-orange-100 text-orange-900 border-orange-300", "bg-pink-100 text-pink-900 border-pink-300"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const actor = await requireStaffPage();
  const { m } = await searchParams;
  const now = new Date();
  const [y, mo] = m && /^\d{4}-\d{2}$/.test(m) ? m.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    return d;
  });
  const entries = await calendarEntries(actor, iso(days[0]), iso(days[41]));
  const crews = [...new Set(entries.map((e) => e.crew).filter(Boolean))] as string[];
  const color = (crew: string | null) => (crew ? COLORS[crews.indexOf(crew) % COLORS.length] : "bg-white text-slate-600 border-dashed border-slate-400");
  const monthParam = (offset: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const today = iso(now);
  const onDay = (d: string) => entries.filter((e) => e.start <= d && (e.end ?? e.start) >= d);

  return (
    <>
      <PageHeader
        title={first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
        subtitle="Solid = scheduled crew · dashed = proposed start, no crew yet"
        actions={
          <>
            <Link href={`/hub/calendar?m=${monthParam(-1)}`} className="btn-secondary">‹ Prev</Link>
            <Link href="/hub/calendar" className="btn-secondary">Today</Link>
            <Link href={`/hub/calendar?m=${monthParam(1)}`} className="btn-secondary">Next ›</Link>
          </>
        }
      />

      {/* Phone: agenda list */}
      <div className="space-y-2 md:hidden">
        {days.filter((d) => d.getUTCMonth() === mo - 1).map((d) => {
          const list = onDay(iso(d));
          if (!list.length) return null;
          return (
            <Card key={iso(d)} className={iso(d) === today ? "ring-2 ring-brand-500" : ""}>
              <div className="mb-2 text-sm font-semibold">{d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</div>
              <ul className="space-y-1">
                {list.map((e) => (
                  <li key={e.id}>
                    <Link href={`/hub/jobs/${e.id}`} className={`block rounded border px-2 py-1 text-sm ${color(e.crew)}`}>
                      {e.job_number} {e.title} · {e.crew ?? "No crew"}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
        {!entries.length && <Card><p className="text-sm text-slate-500">Nothing scheduled this month.</p></Card>}
      </div>

      {/* Desktop: month grid */}
      <Card className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-slate-200 text-xs font-semibold text-slate-500">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const ds = iso(d);
            return (
              <div key={ds} className={`min-h-28 border-b border-r border-slate-100 p-1 ${d.getUTCMonth() !== mo - 1 ? "bg-slate-50 text-slate-400" : ""}`}>
                <div className={`mb-1 text-xs ${ds === today ? "inline-block rounded-full bg-brand-600 px-1.5 font-bold text-white" : ""}`}>{d.getUTCDate()}</div>
                <div className="space-y-0.5">
                  {onDay(ds).map((e) => (
                    <Link key={e.id} href={`/hub/jobs/${e.id}`} title={`${e.title} — ${e.crew ?? "no crew yet"}`} className={`block truncate rounded border px-1 text-[11px] leading-5 ${color(e.crew)}`}>
                      {e.job_number} {e.crew ? e.crew.split(" ")[0] : "proposed"}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {crews.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {crews.map((c) => <span key={c} className={`rounded border px-2 py-0.5 ${color(c)}`}>{c}</span>)}
        </div>
      )}
    </>
  );
}
