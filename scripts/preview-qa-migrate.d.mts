import type { ClientConfig, ClientBase } from "pg";

export type PreviewQaUrlIdentity = {
  host: string;
  port: string;
  database: string;
  role: string;
  projectRef: string | null;
  sharedPooler: boolean;
};

export type PreviewQaServerIdentity = {
  db: string;
  session_user: string;
  port: number | string | null;
  system_identifier: string | null;
};

export function qaConnectionOptions(
  url: string,
  env?: Record<string, string | undefined>,
): ClientConfig;

export function urlIdentity(url: string): PreviewQaUrlIdentity;

export function fingerprint(url: string): string;

export function serverIdentityHash(row: PreviewQaServerIdentity): string;

export function refuseProduction(
  url: string,
  env?: Record<string, string | undefined>,
): string | null;

export function identityProblems(
  url: string,
  env?: Record<string, string | undefined>,
): string[];

export function readServerIdentity(
  client: Pick<ClientBase, "query">,
): Promise<PreviewQaServerIdentity>;

/**
 * The migration planner and the verification table are part of this script's public
 * surface — the QA test drives them directly — so they are declared here too. Without
 * them `npm run typecheck` reported 34 errors, all of them "property does not exist on
 * the script's type", which is a typing gap rather than a code defect.
 */
export type PreviewQaVerificationRow = { n: number };

/** [name, sql, predicate over the row the query returns] */
export type PreviewQaVerification = [
  name: string,
  sql: string,
  ok: (row: PreviewQaVerificationRow) => boolean,
];

export type PreviewQaPlan = { applied: string[]; pending: string[]; problems: string[] };

export function plan(
  journal: { entries: { tag: string; when: number }[] },
  appliedHashes: string[],
  readSql: (tag: string) => string,
): PreviewQaPlan;

export const VERIFY: PreviewQaVerification[];

/**
 * A receipt is finished by `result`; a run that refuses before it starts (no URL, a
 * production target, a mismatched server identity) returns `{ code, receipt }` with an
 * explanation in `refused` instead, so `result` is optional on purpose.
 */
export type PreviewQaReceipt = {
  at: string;
  mode: string;
  dbFingerprint?: string;
  target?: {
    host: string;
    port: string;
    database: string;
    role: string;
    projectRef: string | null;
    sharedPooler: boolean;
  };
  refused?: string;
  verify?: { name: string; pass: boolean; value?: number; error?: string }[];
  verifySkipped?: string;
  after?: { problems: string[]; pending: string[] };
  result?: { pass: boolean; failures: string[] };
};

export function receiptFailures(receipt: PreviewQaReceipt): string[];

export function run(options: {
  mode?: string;
  env?: Record<string, string | undefined>;
  connect: (url: string) => unknown | Promise<unknown>;
  runMigrations?: () => Promise<void>;
  readJournal?: () => { entries: { tag: string; when: number }[] };
  readSql?: (tag: string) => string;
  writeReceipt?: (receipt: PreviewQaReceipt) => unknown;
  log?: (line: string) => void;
}): Promise<{ code: number; receipt: PreviewQaReceipt }>;
