import Link from "next/link";
import { markAllReadAction } from "@/app/notifications/actions";
import { Card, Empty } from "./ui";

type N = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export function NotificationList({ items }: { items: N[] }) {
  return (
    <Card
      title="Notifications"
      actions={
        items.some((n) => !n.read_at) && (
          <form action={markAllReadAction}><button className="text-sm text-brand-600 hover:underline">Mark all read</button></form>
        )
      }
    >
      {!items.length && <Empty>No notifications.</Empty>}
      <ul className="divide-y divide-slate-100">
        {items.map((n) => (
          <li key={n.id} className="py-2.5">
            <Link href={n.link ?? "#"} className="block">
              <div className="flex items-center gap-2">
                {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="unread" />}
                <span className={`text-sm ${n.read_at ? "text-slate-600" : "font-semibold"}`}>{n.title}</span>
              </div>
              {n.body && <div className="text-sm text-slate-500">{n.body}</div>}
              <div className="text-xs text-slate-400">{new Date(n.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
