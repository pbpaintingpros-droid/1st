import type { CrewOfferStatus } from "@/lib/services/crew";
import { Badge, type Tone } from "./ui";

const MAP: Record<CrewOfferStatus, [string, Tone]> = {
  new: ["New offer", "blue"],
  accepted: ["You accepted — PB will confirm", "green"],
  counter_pending: ["Your counteroffer is under review", "amber"],
  walkthrough_requested: ["Walkthrough requested", "purple"],
  declined: ["You declined", "gray"],
  awarded: ["Awarded to you", "green"],
  closed: ["No longer available", "gray"],
};

export const CrewStatusBadge = ({ status }: { status: CrewOfferStatus }) => {
  const [label, tone] = MAP[status];
  return <Badge tone={tone}>{label}</Badge>;
};
