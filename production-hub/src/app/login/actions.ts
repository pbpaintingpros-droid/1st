"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth/core";
import { SESSION_COOKIE, setSessionCookie } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function loginAction(form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const result = await login(await getDb(), email, password);
  if (!result.ok) {
    redirect(`/login?error=${result.reason === "locked" ? "locked" : "invalid"}`);
  }
  await setSessionCookie(result.token);
  redirect(result.actor.role === "sub" ? "/crew" : "/hub");
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await logout(await getDb(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
