import {
  IntegrationNotConnectedError,
  type CrmSource,
  type IntegrationStatus,
  type PhotoSource,
  type SheetSink,
  type SmsChannel,
} from "./types";

const has = (...vars: string[]) => vars.every((v) => !!process.env[v]);

export function integrationStatuses(): IntegrationStatus[] {
  return [
    {
      key: "dripjobs",
      name: "DripJobs",
      purpose: "Pull sold jobs into the Hub so they don't have to be retyped",
      mode: "sample",
      verified: false,
      configured: has("DRIPJOBS_API_KEY"),
      direction: "Inbound only (read)",
      envVars: ["DRIPJOBS_API_KEY"],
      nextStep: "Confirm DripJobs offers API or Zapier access on your plan; until then use CSV export → Import.",
    },
    {
      key: "companycam",
      name: "CompanyCam",
      purpose: "Attach project photos to jobs and share selected ones with the crew",
      mode: "sample",
      verified: false,
      configured: has("COMPANYCAM_TOKEN"),
      direction: "Inbound only (read)",
      envVars: ["COMPANYCAM_TOKEN"],
      nextStep: "Create a CompanyCam API token (Settings → Integrations) and test on one project.",
    },
    {
      key: "google_sheets",
      name: "Google Sheets",
      purpose: "Weekly production/assignment summary for the executive review",
      mode: "sample",
      verified: false,
      configured: has("GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEET_ID"),
      direction: "Outbound (write to a report sheet) — needs approval",
      envVars: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEET_ID"],
      nextStep: "Pick the target sheet; share it with a service account.",
    },
    {
      key: "ringcentral",
      name: "RingCentral",
      purpose: "Text subs when a new offer is waiting (link only, no prices in the text)",
      mode: "sample",
      verified: false,
      configured: has("RINGCENTRAL_CLIENT_ID", "RINGCENTRAL_CLIENT_SECRET", "RINGCENTRAL_JWT", "RINGCENTRAL_FROM_NUMBER"),
      direction: "Outbound (SMS) — queued in outbox, owner approves",
      envVars: ["RINGCENTRAL_CLIENT_ID", "RINGCENTRAL_CLIENT_SECRET", "RINGCENTRAL_JWT", "RINGCENTRAL_FROM_NUMBER"],
      nextStep: "Confirm SMS is enabled on the business number and register A2P 10DLC if required.",
    },
  ];
}

/** Outbound sending is hard-off unless explicitly enabled. */
export function outboundEnabled(): boolean {
  return process.env.OUTBOUND_MESSAGING_ENABLED === "true";
}

// Placeholder adapters. Replace each with a real client once verified.
export const dripJobs: CrmSource = {
  async listSoldJobs() {
    throw new IntegrationNotConnectedError("DripJobs");
  },
};
export const companyCam: PhotoSource = {
  async findProjectForAddress() {
    throw new IntegrationNotConnectedError("CompanyCam");
  },
  async listPhotos() {
    throw new IntegrationNotConnectedError("CompanyCam");
  },
};
export const googleSheets: SheetSink = {
  async appendRows() {
    throw new IntegrationNotConnectedError("Google Sheets");
  },
};
export const ringCentral: SmsChannel = {
  async send() {
    if (!outboundEnabled()) throw new Error("Outbound messaging is disabled (OUTBOUND_MESSAGING_ENABLED is not 'true').");
    throw new IntegrationNotConnectedError("RingCentral");
  },
};
