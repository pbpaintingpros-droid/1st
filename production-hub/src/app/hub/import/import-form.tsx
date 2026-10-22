"use client";

import { useActionState } from "react";
import { importAction, type ImportState } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState | null, FormData>(importAction, null);
  const errors = state?.rows.filter((r) => r.errors.length).length ?? 0;
  const willImport = state?.rows.filter((r) => !r.errors.length && !r.duplicate).length ?? 0;

  return (
    <div className="space-y-4">
      <form action={action} className="card space-y-3 p-4">
        <input type="hidden" name="step" value="preview" />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="kind" value="jobs" defaultChecked /> Jobs</label>
          <label className="flex items-center gap-2"><input type="radio" name="kind" value="subcontractors" /> Subcontractors</label>
        </div>
        <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm" />
        <button className="btn-primary" disabled={pending}>{pending ? "Checking…" : "Preview import"}</button>
        <p className="text-xs text-slate-500">
          Templates: <a className="text-brand-600 underline" href="/templates/jobs-template.csv">jobs</a> ·{" "}
          <a className="text-brand-600 underline" href="/templates/subcontractors-template.csv">subcontractors</a>. Lists (services, cities) use semicolons.
        </p>
      </form>

      {state?.error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</div>}
      {state?.message && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{state.message}</div>}

      {state && state.rows.length > 0 && !state.done && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <b>{state.fileName}</b>: {state.rows.length} rows · <span className="text-emerald-700">{willImport} ready</span>
              {errors > 0 && <> · <span className="text-red-700">{errors} with errors</span></>}
            </div>
            <form action={action}>
              <input type="hidden" name="step" value="commit" />
              <button className="btn-success" disabled={pending || errors > 0 || willImport === 0}>
                {errors > 0 ? "Fix errors first" : `Import ${willImport} ${state.kind}`}
              </button>
            </form>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead><tr><th className="th">Line</th><th className="th">Record</th><th className="th">Result</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {state.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="td text-slate-500">{r.line}</td>
                    <td className="td">{String((r.data as Record<string, unknown> | null)?.job_number ?? (r.data as Record<string, unknown> | null)?.company_name ?? "—")} {String((r.data as Record<string, unknown> | null)?.title ?? "")}</td>
                    <td className="td">
                      {r.errors.map((e) => <div key={e} className="text-red-700">✕ {e}</div>)}
                      {r.warnings.map((w) => <div key={w} className="text-amber-700">! {w}</div>)}
                      {!r.errors.length && !r.duplicate && <span className="text-emerald-700">✓ will import</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
