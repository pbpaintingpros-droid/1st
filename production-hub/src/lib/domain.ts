export const SERVICES = [
  { key: "interior", label: "Interior" },
  { key: "exterior", label: "Exterior" },
  { key: "cabinets", label: "Cabinets" },
  { key: "drywall", label: "Drywall & texture" },
  { key: "stucco", label: "Stucco" },
  { key: "wood_metal", label: "Wood & metal" },
  { key: "epoxy", label: "Epoxy" },
  { key: "pergola_fence", label: "Pergolas / fences" },
  { key: "doors", label: "Doors" },
  { key: "wallpaper", label: "Wallpaper removal" },
  { key: "skim_coat", label: "Skim coating" },
] as const;
export type ServiceKey = (typeof SERVICES)[number]["key"];
export const SERVICE_KEYS = SERVICES.map((s) => s.key) as string[];
export const serviceLabel = (k: string) => SERVICES.find((s) => s.key === k)?.label ?? k;

export const DOC_TYPES = [
  { key: "general_liability", label: "General liability insurance", required: true },
  { key: "workers_comp", label: "Workers' comp insurance", required: false },
  { key: "workers_comp_exemption", label: "Workers' comp exemption", required: false },
  { key: "w9", label: "W-9", required: true },
  { key: "sub_agreement", label: "Signed subcontractor agreement", required: true },
  { key: "contractor_license", label: "Contractor license (CSLB)", required: false },
  { key: "other", label: "Other", required: false },
] as const;
export const docLabel = (k: string) => DOC_TYPES.find((d) => d.key === k)?.label ?? k;

export const ONBOARDING_STEPS = [
  { key: "intro_call", label: "Intro call completed" },
  { key: "references_checked", label: "References checked" },
  { key: "sample_job_reviewed", label: "Past work / sample job reviewed" },
  { key: "payment_setup", label: "Payment details set up" },
  { key: "standards_reviewed", label: "PB quality standards reviewed" },
  { key: "portal_login_sent", label: "Crew portal login created" },
] as const;

export type JobStatus = "draft" | "ready" | "offering" | "assigned" | "in_progress" | "complete" | "cancelled";
export type OfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "countered"
  | "walkthrough_requested"
  | "awarded"
  | "not_selected"
  | "withdrawn";

/** Offers the sub can still act on. */
export const OPEN_OFFER_STATUSES: OfferStatus[] = ["sent", "countered", "walkthrough_requested", "accepted"];

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString();
  const [y, m, day] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
