import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getBrand } from "@/lib/config/brand";
import { readCoachConfig } from "@/lib/services/coach/config";

/**
 * Integration status — configuration *state*, never configuration *values*.
 *
 * The owner console needs to answer "is storage connected, is Telegram
 * configured, is an external model wired?" without a single secret being sent to
 * a browser. Nothing in this module reads a secret into a return value: it only
 * reports whether a variable is present, and (for names that are not sensitive)
 * what it is set to.
 *
 * This is also the honest place to record that a real external boundary has not
 * been exercised: `unverified` means "configured, but never proven against the
 * real provider from this environment".
 */

export type IntegrationState = "connected" | "not_configured" | "error" | "unverified";

export type IntegrationReport = {
  key: string;
  state: IntegrationState;
  /** Safe, human-readable detail: never a key, token or connection string. */
  detail?: string;
  checkedAt: string;
};

function present(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0;
}

async function databaseReport(): Promise<IntegrationReport> {
  const checkedAt = new Date().toISOString();
  try {
    await db.execute(sql`select 1`);
    return { key: "database", state: "connected", checkedAt };
  } catch {
    // The failure message could contain the connection string; report the state
    // only, never the driver's message.
    return { key: "database", state: "error", checkedAt };
  }
}

function storageReport(): IntegrationReport {
  const checkedAt = new Date().toISOString();
  const provider = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  if (provider === "local") {
    return {
      key: "storage",
      state: "connected",
      detail: "local disk (development provider)",
      checkedAt,
    };
  }
  const required = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME"];
  const missing = required.filter((name) => !present(name));
  if (missing.length > 0) {
    return { key: "storage", state: "not_configured", detail: `missing ${missing.length} variable(s)`, checkedAt };
  }
  return {
    key: "storage",
    state: "unverified",
    detail: `${provider} · bucket ${process.env.R2_BUCKET_NAME}`,
    checkedAt,
  };
}

function telegramReport(): IntegrationReport {
  const checkedAt = new Date().toISOString();
  if (!present("TELEGRAM_BOT_TOKEN") && !present("TELEGRAM_BOT_USERNAME")) {
    return { key: "telegram", state: "not_configured", checkedAt };
  }
  return {
    key: "telegram",
    state: "unverified",
    detail: present("TELEGRAM_BOT_USERNAME") ? `@${process.env.TELEGRAM_BOT_USERNAME}` : "bot configured",
    checkedAt,
  };
}

function emailReport(): IntegrationReport {
  const checkedAt = new Date().toISOString();
  if (!present("EMAIL_PROVIDER") && !present("SMTP_URL") && !present("RESEND_API_KEY")) {
    return { key: "email", state: "not_configured", checkedAt };
  }
  return { key: "email", state: "unverified", checkedAt };
}

function externalAiReport(): IntegrationReport {
  const checkedAt = new Date().toISOString();
  const config = readCoachConfig();
  const isInternal = config.aiPrimaryProvider === "riwi";
  if (isInternal || !config.externalEnabled) {
    return {
      key: "external_ai",
      state: "not_configured",
      detail: `primary evaluator: ${getBrand().aiDisplayName}`,
      checkedAt,
    };
  }
  // A provider id is configured, but whether that adapter exists (and whether
  // its credentials work) is only knowable by calling it — which this phase
  // deliberately does not do.
  return {
    key: "external_ai",
    state: "unverified",
    detail: `configured id: ${config.aiPrimaryProvider}`,
    checkedAt,
  };
}

function speechReport(): IntegrationReport {
  const checkedAt = new Date().toISOString();
  const config = readCoachConfig();
  if (config.sttPrimaryProvider === "none") {
    return {
      key: "speech_to_text",
      state: "not_configured",
      detail: "transcripts are typed by the student, labelled as such",
      checkedAt,
    };
  }
  return {
    key: "speech_to_text",
    state: "unverified",
    detail: `configured id: ${config.sttPrimaryProvider}`,
    checkedAt,
  };
}

/** The whole report: one row per integration boundary. */
export async function integrationReport(): Promise<IntegrationReport[]> {
  const [database] = await Promise.all([databaseReport()]);
  return [
    database,
    storageReport(),
    telegramReport(),
    emailReport(),
    externalAiReport(),
    speechReport(),
  ];
}
