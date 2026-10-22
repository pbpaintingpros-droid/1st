/**
 * Pure business rules: job readiness, subcontractor compliance, and matching.
 * No database access here, so these are easy to test and to change.
 */
import { todayISO } from "@/lib/domain";

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  /** blocking checks must pass before an offer can be created or sent */
  blocking: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Job readiness — must pass before any offer goes out
// ---------------------------------------------------------------------------
export interface ReadinessInput {
  status: string;
  services: string[];
  work_order: string | null;
  target_payout_cents: number | null;
  proposed_start: string | null;
  deposit_received: boolean;
  colors_confirmed: boolean;
  crew_photo_count: number;
}

export function jobReadiness(job: ReadinessInput): { ready: boolean; checks: Check[] } {
  const checks: Check[] = [
    {
      key: "open",
      label: "Job is open for assignment",
      ok: ["draft", "ready", "offering"].includes(job.status),
      blocking: true,
      detail: `Status: ${job.status}`,
    },
    { key: "services", label: "Services listed", ok: job.services.length > 0, blocking: true },
    {
      key: "work_order",
      label: "Work order written",
      ok: (job.work_order ?? "").trim().length >= 20,
      blocking: true,
      detail: "Crews only see what's in the work order.",
    },
    { key: "target_payout", label: "Target payout set", ok: job.target_payout_cents != null, blocking: true },
    { key: "proposed_start", label: "Proposed start date set", ok: !!job.proposed_start, blocking: true },
    { key: "deposit", label: "Customer deposit received", ok: job.deposit_received, blocking: true },
    { key: "colors", label: "Colors / products confirmed", ok: job.colors_confirmed, blocking: false },
    { key: "photos", label: "Photos shared with crew", ok: job.crew_photo_count > 0, blocking: false },
  ];
  return { ready: checks.every((c) => c.ok || !c.blocking), checks };
}

// ---------------------------------------------------------------------------
// Subcontractor compliance — insurance & paperwork
// ---------------------------------------------------------------------------
export interface DocInput {
  doc_type: string;
  expires_on: string | null;
  verified_at: string | null;
}

export interface ComplianceInput {
  status: string;
  documents: DocInput[];
}

function daysUntil(dateISO: string, from = todayISO()): number {
  return Math.round((Date.parse(dateISO) - Date.parse(from)) / 86_400_000);
}

function bestDoc(docs: DocInput[], types: string[]) {
  return docs
    .filter((d) => types.includes(d.doc_type) && d.verified_at)
    .sort((a, b) => (b.expires_on ?? "9999").localeCompare(a.expires_on ?? "9999"))[0];
}

export function subCompliance(
  sub: ComplianceInput,
  opts: { expiryWarningDays: number; today?: string } = { expiryWarningDays: 30 },
): { compliant: boolean; checks: Check[] } {
  const today = opts.today ?? todayISO();
  const docCheck = (key: string, label: string, types: string[], expires: boolean): Check => {
    const doc = bestDoc(sub.documents, types);
    if (!doc) return { key, label, ok: false, blocking: true, detail: "Missing or not verified" };
    if (expires) {
      if (!doc.expires_on) return { key, label, ok: false, blocking: true, detail: "No expiration date on file" };
      const days = daysUntil(doc.expires_on, today);
      if (days < 0) return { key, label, ok: false, blocking: true, detail: `Expired ${doc.expires_on}` };
      if (days <= opts.expiryWarningDays)
        return { key, label, ok: true, blocking: true, detail: `Expires in ${days} days` };
    }
    return { key, label, ok: true, blocking: true };
  };

  const checks: Check[] = [
    { key: "active", label: "Status is active", ok: sub.status === "active", blocking: true, detail: sub.status },
    docCheck("gl", "General liability insurance", ["general_liability"], true),
    docCheck("wc", "Workers' comp (or exemption)", ["workers_comp", "workers_comp_exemption"], true),
    docCheck("w9", "W-9 on file", ["w9"], false),
    docCheck("agreement", "Signed subcontractor agreement", ["sub_agreement"], false),
  ];
  // workers' comp exemption forms don't always carry an expiration date
  const wc = checks[2];
  if (!wc.ok && wc.detail === "No expiration date on file") {
    const exemption = bestDoc(sub.documents, ["workers_comp_exemption"]);
    if (exemption && !exemption.expires_on) checks[2] = { ...wc, ok: true, detail: "Exemption on file" };
  }
  return { compliant: checks.every((c) => c.ok), checks };
}

// ---------------------------------------------------------------------------
// Matching rules — configurable by the owner in Settings
// ---------------------------------------------------------------------------
export interface MatchingRules {
  requireAllSkills: boolean; // sub must do every service on the job
  requireServiceArea: boolean; // job city must be in the sub's service areas
  respectCapacity: boolean; // sub can't exceed their max active jobs
  minQualityRating: number | null; // 1–5, or null for no minimum
  insuranceExpiryWarningDays: number;
}

export const DEFAULT_MATCHING_RULES: MatchingRules = {
  requireAllSkills: true,
  requireServiceArea: true,
  respectCapacity: true,
  minQualityRating: 3,
  insuranceExpiryWarningDays: 30,
};

export interface MatchSubInput extends ComplianceInput {
  id: string;
  company_name: string;
  skills: string[];
  service_areas: string[];
  quality_rating: number | null;
  max_active_jobs: number;
  active_job_count: number;
}

export interface MatchResult {
  subcontractorId: string;
  companyName: string;
  eligible: boolean;
  /** compliance problems can never be overridden */
  complianceOk: boolean;
  score: number;
  reasons: { ok: boolean; text: string }[];
}

export function matchSubs(
  job: { services: string[]; city: string },
  subs: MatchSubInput[],
  rules: MatchingRules,
): MatchResult[] {
  return subs
    .map((s) => {
      const reasons: { ok: boolean; text: string }[] = [];
      let eligible = true;
      let score = 0;

      const compliance = subCompliance(s, { expiryWarningDays: rules.insuranceExpiryWarningDays });
      for (const c of compliance.checks.filter((c) => !c.ok)) {
        reasons.push({ ok: false, text: `${c.label}: ${c.detail ?? "missing"}` });
      }
      if (!compliance.compliant) eligible = false;

      const missing = job.services.filter((x) => !s.skills.includes(x));
      const covered = job.services.length - missing.length;
      score += job.services.length ? (covered / job.services.length) * 40 : 40;
      if (missing.length) {
        reasons.push({ ok: false, text: `Doesn't list: ${missing.join(", ")}` });
        if (rules.requireAllSkills) eligible = false;
      } else reasons.push({ ok: true, text: "Does every service on this job" });

      const inArea = s.service_areas.includes(job.city.trim().toLowerCase());
      if (inArea) {
        score += 25;
        reasons.push({ ok: true, text: `Works in ${job.city}` });
      } else {
        reasons.push({ ok: false, text: `${job.city} not in service area` });
        if (rules.requireServiceArea) eligible = false;
      }

      if (s.quality_rating != null) score += s.quality_rating * 4;
      if (rules.minQualityRating != null && (s.quality_rating ?? 0) < rules.minQualityRating) {
        reasons.push({ ok: false, text: `Quality rating ${s.quality_rating ?? "none"} below ${rules.minQualityRating}` });
        eligible = false;
      }

      const openSlots = s.max_active_jobs - s.active_job_count;
      if (openSlots > 0) score += Math.min(openSlots, 3) * 5;
      else {
        reasons.push({ ok: false, text: `At capacity (${s.active_job_count}/${s.max_active_jobs} active jobs)` });
        if (rules.respectCapacity) eligible = false;
      }

      return {
        subcontractorId: s.id,
        companyName: s.company_name,
        eligible,
        complianceOk: compliance.compliant,
        score: Math.round(score),
        reasons,
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

export function parseMatchingRules(value: unknown): MatchingRules {
  const v = (value ?? {}) as Partial<MatchingRules>;
  return {
    requireAllSkills: typeof v.requireAllSkills === "boolean" ? v.requireAllSkills : DEFAULT_MATCHING_RULES.requireAllSkills,
    requireServiceArea:
      typeof v.requireServiceArea === "boolean" ? v.requireServiceArea : DEFAULT_MATCHING_RULES.requireServiceArea,
    respectCapacity: typeof v.respectCapacity === "boolean" ? v.respectCapacity : DEFAULT_MATCHING_RULES.respectCapacity,
    minQualityRating:
      v.minQualityRating === null
        ? null
        : typeof v.minQualityRating === "number" && v.minQualityRating >= 1 && v.minQualityRating <= 5
          ? Math.round(v.minQualityRating)
          : DEFAULT_MATCHING_RULES.minQualityRating,
    insuranceExpiryWarningDays:
      typeof v.insuranceExpiryWarningDays === "number" && v.insuranceExpiryWarningDays >= 0
        ? Math.round(v.insuranceExpiryWarningDays)
        : DEFAULT_MATCHING_RULES.insuranceExpiryWarningDays,
  };
}
