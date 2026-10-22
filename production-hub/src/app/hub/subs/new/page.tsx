import { Card, Flash, PageHeader } from "@/components/ui";
import { SubFields } from "@/components/sub-form";
import { requireStaffPage } from "@/lib/auth/session";
import { createSubAction } from "../actions";

export const metadata = { title: "Add subcontractor" };

export default async function NewSub({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireStaffPage();
  return (
    <>
      <PageHeader title="Add subcontractor" back={{ href: "/hub/subs", label: "Subcontractors" }} />
      <Flash searchParams={await searchParams} />
      <Card>
        <form action={createSubAction} className="space-y-4">
          <SubFields />
          <button className="btn-primary">Add subcontractor</button>
        </form>
      </Card>
    </>
  );
}
