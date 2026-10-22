import { NotificationList } from "@/components/notification-list";
import { requireSubPage } from "@/lib/auth/session";
import { listNotifications } from "@/lib/services/activity";

export const metadata = { title: "Alerts" };

export default async function Page() {
  const actor = await requireSubPage();
  return <NotificationList items={await listNotifications(actor)} />;
}
