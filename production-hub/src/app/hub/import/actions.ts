"use server";

import { getActor } from "@/lib/auth/session";
import { AuthError, ForbiddenError, ValidationError } from "@/lib/errors";
import { commitJobs, commitSubs, previewJobs, previewSubs, type PreviewRow } from "@/lib/import/csv";

export interface ImportState {
  kind: "jobs" | "subcontractors";
  fileName: string;
  csv: string;
  rows: PreviewRow<Record<string, unknown>>[];
  message?: string;
  error?: string;
  done?: boolean;
}

const MAX = 2 * 1024 * 1024;

export async function importAction(prev: ImportState | null, f: FormData): Promise<ImportState | null> {
  const actor = await getActor();
  const step = String(f.get("step") ?? "preview");
  const kind = f.get("kind") === "subcontractors" ? "subcontractors" : "jobs";
  try {
    if (step === "commit" && prev) {
      const r = prev.kind === "jobs" ? await commitJobs(actor, prev.csv, prev.fileName) : await commitSubs(actor, prev.csv, prev.fileName);
      return { ...prev, done: true, message: `Imported ${r.imported} ${prev.kind}. Skipped ${r.skipped} (duplicates). Nothing was changed in DripJobs.` };
    }
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) return { kind, fileName: "", csv: "", rows: [], error: "Choose a CSV file" };
    if (file.size > MAX) return { kind, fileName: file.name, csv: "", rows: [], error: "File is larger than 2 MB" };
    const csv = await file.text();
    const rows = (kind === "jobs" ? await previewJobs(actor, csv) : await previewSubs(actor, csv)) as unknown as PreviewRow<Record<string, unknown>>[];
    return { kind, fileName: file.name, csv, rows };
  } catch (e) {
    if (e instanceof AuthError || e instanceof ForbiddenError || e instanceof ValidationError)
      return { ...(prev ?? { kind, fileName: "", csv: "", rows: [] }), error: e.message };
    console.error(e);
    return { ...(prev ?? { kind, fileName: "", csv: "", rows: [] }), error: "Import failed. Nothing was imported." };
  }
}
