import { redirect } from "next/navigation";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Runs a server-action body. Expected errors become a message on the page
 * (?error=...); anything unexpected is logged and shown as a generic error.
 */
type ActionResult = string | void | { message: string; to: string };

export async function runAction(back: string, fn: () => Promise<ActionResult>): Promise<never> {
  let ok: ActionResult;
  try {
    ok = await fn();
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    const known = e instanceof ValidationError || e instanceof ForbiddenError || e instanceof NotFoundError;
    if (!known) console.error(e);
    const msg = known ? (e as Error).message : "Something went wrong. Nothing was changed.";
    redirect(withParam(back, "error", msg));
  }
  if (ok && typeof ok === "object") redirect(withParam(ok.to, "ok", ok.message));
  redirect(withParam(back, "ok", ok || "Saved"));
}

function withParam(path: string, key: string, value: string) {
  const [base, q] = path.split("?");
  const p = new URLSearchParams(q);
  p.delete("ok");
  p.delete("error");
  p.set(key, value);
  return `${base}?${p.toString()}`;
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (f: FormData, k: string) => str(f, k) || null;
export const optDate = (f: FormData, k: string) => {
  const v = str(f, k);
  return v ? v : null;
};
