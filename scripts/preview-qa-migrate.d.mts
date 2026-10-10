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

export const ALLOWED_PENDING: readonly string[];
export function plan(journal: { entries: {tag: string; when: number; idx?: number}[] }, appliedHashes: string[], readSql: (tag: string) => string | undefined): { applied: string[]; pending: string[]; problems: string[] };

export const VERIFY: readonly (readonly [string, string, number])[];
export function run(options: Record<string, unknown>): Promise<{ code: number; receipt: { result?: { pass: boolean; failures: string[] }; refused?: string; verifySkipped?: string; verify?: unknown } }>;
