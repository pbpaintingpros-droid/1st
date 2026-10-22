import { SERVICES } from "@/lib/domain";
import type { SubRow } from "@/lib/services/subs";

export function SubFields({ sub }: { sub?: SubRow }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="company_name">Company</label>
          <input id="company_name" name="company_name" required defaultValue={sub?.company_name} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="contact_name">Contact name</label>
          <input id="contact_name" name="contact_name" required defaultValue={sub?.contact_name} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" defaultValue={sub?.phone ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={sub?.email ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sub?.status ?? "prospect"} className="input">
            {["prospect", "onboarding", "active", "paused", "inactive"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label" htmlFor="crew_size">Crew</label>
            <input id="crew_size" name="crew_size" inputMode="numeric" defaultValue={sub?.crew_size ?? ""} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="max_active_jobs">Max jobs</label>
            <input id="max_active_jobs" name="max_active_jobs" inputMode="numeric" defaultValue={sub?.max_active_jobs ?? 2} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="quality_rating">Rating</label>
            <select id="quality_rating" name="quality_rating" defaultValue={sub?.quality_rating ?? ""} className="input">
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>
      <fieldset>
        <legend className="label">Services they do</legend>
        <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
          {SERVICES.map((s) => (
            <label key={s.key} className="flex items-center gap-2">
              <input type="checkbox" name="skills" value={s.key} defaultChecked={sub?.skills.includes(s.key)} /> {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="service_areas">Cities they work in (comma-separated)</label>
        <input id="service_areas" name="service_areas" defaultValue={sub?.service_areas.join(", ")} className="input" placeholder="San Diego, La Mesa, El Cajon" />
      </div>
      <div>
        <label className="label" htmlFor="internal_notes">Internal notes (sub never sees)</label>
        <textarea id="internal_notes" name="internal_notes" rows={2} defaultValue={sub?.internal_notes ?? ""} className="input" />
      </div>
    </div>
  );
}
