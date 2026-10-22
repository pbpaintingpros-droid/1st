"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { markAllRead } from "@/lib/services/activity";

export async function markAllReadAction(f: FormData) {
  const actor = await getActor();
  await markAllRead(actor);
  redirect(actor?.role === "sub" ? "/crew/notifications" : "/hub/notifications");
}
