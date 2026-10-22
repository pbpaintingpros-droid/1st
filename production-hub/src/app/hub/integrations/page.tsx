import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { integrationStatuses, outboundEnabled } from "@/lib/integrations";
import { listOutbox } from "@/lib/services/activity";

export const metadata = { title: "Integrations" };

export default async function Page() {
  const actor = await requireStaffPage();
  const outbox = await listOutbox(actor);
  return (
    <>
      <PageHeader title="Integrations" subtitle="Nothing is connected yet. The Hub runs on sample data and CSV imports until each connection is tested and you approve it." />
      <div className="grid gap-4 md:grid-cols-2">
        {integrationStatuses().map((i) => (
          <Card key={i.key} title={i.name} actions={i.verified ? <Badge tone="green">Live</Badge> : <Badge tone="amber">Not connected</Badge>}>
            <p className="text-sm">{i.purpose}</p>
            <dl className="mt-3 grid grid-cols-3 gap-1 text-sm">
              <dt className="text-slate-500">Direction</dt><dd className="col-span-2">{i.direction}</dd>
              <dt className="text-slate-500">Credentials</dt><dd className="col-span-2">{i.configured ? "Set" : "Not set"}</dd>
              <dt className="text-slate-500">Next step</dt><dd className="col-span-2">{i.nextStep}</dd>
            </dl>
          </Card>
        ))}
      </div>

      <Card title="Outbox — messages waiting for approval" className="mt-5" actions={<Badge tone={outboundEnabled() ? "red" : "gray"}>Sending {outboundEnabled() ? "ON" : "OFF"}</Badge>}>
        <p className="mb-3 text-sm text-slate-600">When an offer is sent, a text to the sub is drafted here. It will not go out until RingCentral is connected, sending is turned on, and you approve it.</p>
        {!outbox.length && <Empty>No queued messages.</Empty>}
        <ul className="divide-y divide-slate-100">
          {outbox.map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{m.channel}</Badge>
                <span className="font-mono text-xs">{m.recipient}</span>
                <Badge tone="amber">{m.status.replace("_", " ")}</Badge>
                <span className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-slate-700">{String(m.payload.text ?? "")}</div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
