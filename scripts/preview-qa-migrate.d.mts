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
  env?: NodeJS.ProcessEnv,
): ClientConfig;

export function urlIdentity(url: string): PreviewQaUrlIdentity;

export function fingerprint(url: string): string;

export function serverIdentityHash(row: PreviewQaServerIdentity): string;

export function refuseProduction(
  url: string,
  env?: NodeJS.ProcessEnv,
): string | null;

export function identityProblems(
  url: string,
  env?: NodeJS.ProcessEnv,
): string[];

export function readServerIdentity(
  client: Pick<ClientBase, "query">,
): Promise<PreviewQaServerIdentity>;
