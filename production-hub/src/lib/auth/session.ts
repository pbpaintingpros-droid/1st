import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { actorFromToken, SESSION_DAYS, type Actor } from "./core";

export const SESSION_COOKIE = "pbhub_session";

export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return actorFromToken(await getDb(), token);
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

/** For internal (Hub) pages. Subs are sent to their portal. */
export async function requireStaffPage(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "sub") redirect("/crew");
  return actor;
}

/** For Crew Portal pages. Staff are sent to the Hub. */
export async function requireSubPage(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "sub") redirect("/hub");
  return actor;
}
