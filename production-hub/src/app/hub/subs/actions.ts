"use server";

import { optDate, optStr, runAction, str } from "@/lib/actions";
import { getActor } from "@/lib/auth/session";
import { SERVICE_KEYS } from "@/lib/domain";
import { addSubDocument, createSub, createSubLogin, setOnboardingStep, updateSub, verifySubDocument, type SubInput } from "@/lib/services/subs";

function subInput(f: FormData): SubInput {
  const num = (k: string) => (str(f, k) ? Number(str(f, k)) : null);
  return {
    company_name: str(f, "company_name"),
    contact_name: str(f, "contact_name"),
    phone: optStr(f, "phone"),
    email: optStr(f, "email"),
    status: str(f, "status") || "prospect",
    skills: f.getAll("skills").map(String).filter((s) => SERVICE_KEYS.includes(s)),
    service_areas: str(f, "service_areas").split(/[,;\n]/),
    crew_size: num("crew_size"),
    max_active_jobs: num("max_active_jobs") ?? 2,
    quality_rating: num("quality_rating"),
    internal_notes: optStr(f, "internal_notes"),
  };
}

export async function createSubAction(f: FormData) {
  await runAction("/hub/subs/new", async () => {
    const sub = await createSub(await getActor(), subInput(f));
    return { message: "Subcontractor added", to: `/hub/subs/${sub.id}` };
  });
}

export async function updateSubAction(f: FormData) {
  const id = str(f, "subId");
  await runAction(`/hub/subs/${id}`, async () => {
    await updateSub(await getActor(), id, subInput(f));
    return "Profile saved";
  });
}

export async function addDocumentAction(f: FormData) {
  const id = str(f, "subId");
  await runAction(`/hub/subs/${id}`, async () => {
    const file = f.get("file");
    const upload =
      file instanceof File && file.size > 0
        ? { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
        : null;
    await addSubDocument(await getActor(), id, {
      doc_type: str(f, "doc_type"),
      expires_on: optDate(f, "expires_on"),
      notes: optStr(f, "notes"),
      file: upload,
    });
    return "Document added — verify it once you've checked it";
  });
}

export async function verifyDocumentAction(f: FormData) {
  const id = str(f, "subId");
  await runAction(`/hub/subs/${id}`, async () => {
    await verifySubDocument(await getActor(), str(f, "documentId"));
    return "Document verified";
  });
}

export async function onboardingAction(f: FormData) {
  const id = str(f, "subId");
  await runAction(`/hub/subs/${id}`, async () => {
    await setOnboardingStep(await getActor(), id, str(f, "step"), str(f, "done") === "1");
    return "Onboarding updated";
  });
}

export async function createLoginAction(f: FormData) {
  const id = str(f, "subId");
  await runAction(`/hub/subs/${id}`, async () => {
    await createSubLogin(await getActor(), id, str(f, "email"), str(f, "password"));
    return "Crew Portal login created. Nothing was sent — share the login with the sub yourself.";
  });
}
