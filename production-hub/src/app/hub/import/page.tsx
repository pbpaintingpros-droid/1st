import { PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import" };

export default async function Page() {
  await requireStaffPage();
  return (
    <>
      <PageHeader
        title="Import existing records"
        subtitle="Upload a CSV (e.g. exported from DripJobs or your sub list). You'll see a preview before anything is saved. Imports only add to the Production Hub — they never change DripJobs."
      />
      <ImportForm />
    </>
  );
}
