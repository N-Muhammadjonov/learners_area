/**
 * The private-module table is plain ESM so `next.config.mjs` (loaded by the CLI),
 * the Edge middleware bundle and the tests can all import the same file.
 * This declaration is the TypeScript view of it — keep the two in step; the
 * parity test in `tests/app-namespace.test.ts` fails if the shapes diverge.
 */
export type PrivateModule = { segment: string; destination: string };

export const PRIVATE_MODULES: PrivateModule[];
export const APP_HOME: string;
export const APP_HOME_ALIASES: string[];
export function canonicalHomeRedirects(): { source: string; destination: string; permanent: boolean }[];
export const PRIVATE_MODULE_SEGMENTS: string[];
export const ACCOUNT_GATED_PATHS: string[];
export const APP_LEGACY_ALIASES: { source: string; destination: string }[];
export function appLegacyAliasRedirects(): { source: string; destination: string; permanent: boolean }[];
export function legacyModuleRedirects(): { source: string; destination: string; permanent: boolean }[];
