import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/domain";

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="mb-1 inline-block text-sm text-brand-600 hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700",
  blue: "bg-brand-100 text-brand-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  purple: "bg-violet-100 text-violet-800",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

const JOB_STATUS: Record<string, [string, Tone]> = {
  draft: ["Needs info", "gray"],
  ready: ["Ready to offer", "blue"],
  offering: ["Offers out", "amber"],
  assigned: ["Assigned", "green"],
  in_progress: ["In progress", "purple"],
  complete: ["Complete", "gray"],
  cancelled: ["Cancelled", "red"],
};
export const JobStatusBadge = ({ status }: { status: string }) => {
  const [label, tone] = JOB_STATUS[status] ?? [status, "gray"];
  return <Badge tone={tone}>{label}</Badge>;
};

const OFFER_STATUS: Record<string, [string, Tone]> = {
  draft: ["Draft (not sent)", "gray"],
  sent: ["Sent — waiting", "blue"],
  accepted: ["Accepted", "green"],
  declined: ["Declined", "red"],
  countered: ["Counteroffer", "amber"],
  walkthrough_requested: ["Wants walkthrough", "purple"],
  awarded: ["Awarded", "green"],
  not_selected: ["Not selected", "gray"],
  withdrawn: ["Withdrawn", "gray"],
};
export const OfferStatusBadge = ({ status }: { status: string }) => {
  const [label, tone] = OFFER_STATUS[status] ?? [status, "gray"];
  return <Badge tone={tone}>{label}</Badge>;
};

const SUB_STATUS: Record<string, Tone> = { active: "green", onboarding: "blue", prospect: "gray", paused: "amber", inactive: "red" };
export const SubStatusBadge = ({ status }: { status: string }) => <Badge tone={SUB_STATUS[status] ?? "gray"}>{status}</Badge>;

export const Money = ({ cents, className = "" }: { cents: number | null | undefined; className?: string }) => (
  <span className={`tabular-nums ${className}`}>{formatMoney(cents)}</span>
);

export function Flash({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  if (searchParams.error)
    return <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{searchParams.error}</div>;
  if (searchParams.ok)
    return <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{searchParams.ok}</div>;
  return null;
}

export function CheckList({ checks }: { checks: { key: string; label: string; ok: boolean; blocking: boolean; detail?: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-sm">
          <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.ok ? (c.detail?.startsWith("Expires in") ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700") : c.blocking ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
            {c.ok ? "✓" : c.blocking ? "✕" : "!"}
          </span>
          <span>
            <span className={c.ok ? "text-slate-700" : "font-medium text-slate-900"}>{c.label}</span>
            {!c.ok && !c.blocking && <span className="text-amber-700"> (recommended)</span>}
            {c.detail && (!c.ok || c.detail.startsWith("Expires")) && <span className="block text-xs text-slate-500">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SampleBanner() {
  return (
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
      SAMPLE DATA — not connected to DripJobs, CompanyCam, or RingCentral. No messages are sent.
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}
