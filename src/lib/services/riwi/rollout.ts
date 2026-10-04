import type { Role } from "@/lib/auth/roles";

export type RiwiRollout = {
  enabled: boolean;
  roles: Record<Role, boolean>;
  externalAi: boolean;
  knowledgeLearning: boolean;
  providerLab: boolean;
};

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name]?.trim().toLowerCase() === "true" || env[name]?.trim() === "1";
}

/** Missing or unreadable rollout policy is deliberately all-off. */
export function readRiwiRollout(env: NodeJS.ProcessEnv = process.env): RiwiRollout {
  const enabled = flag(env, "RIWI_ENABLED");
  return {
    enabled,
    roles: {
      student: enabled && flag(env, "RIWI_STUDENT_ENABLED"),
      teacher: enabled && flag(env, "RIWI_TEACHER_ENABLED"),
      admin: enabled && flag(env, "RIWI_ADMIN_ENABLED"),
      owner: enabled && flag(env, "RIWI_OWNER_ENABLED"),
    },
    externalAi: enabled && flag(env, "RIWI_EXTERNAL_AI_ENABLED"),
    knowledgeLearning: enabled && flag(env, "RIWI_KNOWLEDGE_LEARNING_ENABLED"),
    providerLab: enabled && flag(env, "RIWI_PROVIDER_LAB_ENABLED"),
  };
}

export function riwiEnabledForRole(role: Role, env: NodeJS.ProcessEnv = process.env): boolean {
  const rollout = readRiwiRollout(env);
  return rollout.enabled && rollout.roles[role];
}
