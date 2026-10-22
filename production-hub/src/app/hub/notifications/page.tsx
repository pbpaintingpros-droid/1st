import { NotificationList } from "@/components/notification-list";
import { PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { listNotifications } from "@/lib/services/activity";

export const metadata = { title: "Notifications" };

export default async function Page() {
  const actor = await requireStaffPage();
  return (
    <>
      <PageHeader title="Notifications" subtitle="In-app only. Nothing is texted or emailed yet." />
      <NotificationList items={await listNotifications(actor)} />
    </>
  );
}
