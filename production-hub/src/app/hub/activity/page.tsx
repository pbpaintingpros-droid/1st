import { ActivityList } from "@/components/activity-list";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { listAudit } from "@/lib/services/activity";

export const metadata = { title: "Activity log" };

export default async function Page() {
  const actor = await requireStaffPage();
  return (
    <>
      <PageHeader title="Activity log" subtitle="Every assignment, price change and offer response. This log can't be edited or deleted." />
      <Card><ActivityList rows={await listAudit(actor, { limit: 300 })} showJob /></Card>
    </>
  );
}
