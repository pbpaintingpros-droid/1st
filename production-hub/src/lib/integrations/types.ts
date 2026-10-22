/**
 * Integration contracts. Each outside system gets an adapter that implements one
 * of these interfaces. Until an adapter is verified against the real account,
 * it stays in "sample" mode: read methods return nothing new and write methods refuse.
 *
 * Rule: inbound data (jobs, photos) is pulled in and reviewed in the Hub.
 * Outbound actions (texts, CRM updates, sheet writes) go through the outbox and
 * need owner approval + OUTBOUND_MESSAGING_ENABLED=true.
 */
export type IntegrationMode = "sample" | "read_only" | "live";

export interface IntegrationStatus {
  key: "dripjobs" | "companycam" | "google_sheets" | "ringcentral";
  name: string;
  purpose: string;
  mode: IntegrationMode;
  verified: boolean;
  configured: boolean;
  direction: string;
  envVars: string[];
  nextStep: string;
}

/** DripJobs (CRM): source of sold jobs. */
export interface CrmSource {
  /** Sold jobs changed since a date, mapped to the Hub's job import shape. */
  listSoldJobs(sinceISO: string): Promise<ExternalJob[]>;
}

export interface ExternalJob {
  externalRef: string;
  jobNumber: string;
  customerName: string;
  address: string;
  city: string;
  zip?: string;
  title: string;
  services: string[];
  contractAmountCents?: number;
  proposedStart?: string;
  scopeText?: string;
}

/** CompanyCam: job photos. */
export interface PhotoSource {
  findProjectForAddress(address: string): Promise<{ projectId: string } | null>;
  listPhotos(projectId: string): Promise<{ externalUrl: string; caption?: string; takenAt: string }[]>;
}

/** Google Sheets: export-only reporting (e.g. weekly production summary). */
export interface SheetSink {
  appendRows(sheetId: string, tab: string, rows: (string | number)[][]): Promise<void>;
}

/** RingCentral: SMS notifications to subs. Always via the outbox. */
export interface SmsChannel {
  send(toE164: string, text: string): Promise<{ id: string }>;
}

export class IntegrationNotConnectedError extends Error {
  constructor(name: string) {
    super(`${name} is not connected yet. The Hub is running on sample data for this integration.`);
  }
}
