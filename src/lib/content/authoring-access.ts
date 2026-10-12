import "server-only";
import type { Role } from "@/lib/auth/roles";
import { listRegisteredAuthors, registerModuleAuthors } from "@/lib/content/authors";
import { mayAuthorContentForRole, type ContentKey } from "@/lib/content/authoring-capabilities";

/**
 * The server-side capability check.
 *
 * `mayAuthorContentForRole` is the rule; this module is the registry probe beside it,
 * kept apart so the rule stays pure and importable by the client and the tests while
 * the registry (a module full of zod schemas) stays on the server.
 *
 * `registerModuleAuthors()` is idempotent, so a route may call this as often as it
 * likes without side effects.
 */
export function mayAuthorContent(role: Role | null | undefined, module: string, contentType: string): boolean {
  registerModuleAuthors();
  const registered = new Set(listRegisteredAuthors().map((author) => `${author.module}:${author.contentType}`));
  return mayAuthorContentForRole(role, module, contentType, (m, c) => registered.has(`${m}:${c}`));
}

/** Every content type this role may author, for a UI that must not offer a dead door. */
export function authorableContentForRole(role: Role | null | undefined): ContentKey[] {
  registerModuleAuthors();
  return listRegisteredAuthors()
    .map((author) => `${author.module}:${author.contentType}`)
    .filter((key) => {
      const [module, contentType] = key.split(":") as [string, string];
      return mayAuthorContent(role, module, contentType);
    })
    .sort();
}
