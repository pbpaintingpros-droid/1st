import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";

export default async function Home() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  redirect(actor.role === "sub" ? "/crew" : "/hub");
}
