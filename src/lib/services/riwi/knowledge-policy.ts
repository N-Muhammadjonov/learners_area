import type { Role } from "@/lib/auth/roles";

export type KnowledgeScope =
  | { kind: "global" }
  | { kind: "role"; role: Role }
  | { kind: "user"; userId: string };

/** Pure counterpart to the SQL retrieval predicate; user-scoped units are self-only. */
export function knowledgeScopeMatches(scope: KnowledgeScope, actor: { id: string; role: Role }): boolean {
  if (scope.kind === "global") return true;
  if (scope.kind === "role") return scope.role === actor.role;
  return scope.userId === actor.id;
}
