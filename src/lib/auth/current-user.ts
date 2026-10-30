/** Identity types and role helpers for operator tools. FastAPI owns live sessions. */
import type { AccountStatus } from "./account-status";
import { isAdministrator, isStaff, type Role } from "./roles";
import type { Actor } from "./ownership";

export type CurrentUser = {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  accountStatus: AccountStatus;
  locale: string;
  onboarded: boolean;
  statusReason: string | null;
};

export function actorOf(user: CurrentUser): Actor {
  return { id: user.id, role: user.role };
}

export const SELF_SERVICE_ROLES: Role[] = ["owner", "admin"];
export { isAdministrator, isStaff };
