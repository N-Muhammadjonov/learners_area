import { BrandBlock } from "./BrandBlock";
import { SidebarNav } from "./SidebarNav";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/roles";

/**
 * The desktop sidebar.
 *
 * Brand on top, navigation below, account at the bottom. It is a server
 * component that composes two pieces — the brand block (static) and the
 * navigation (client, because it needs the current path) — so the shell can be
 * rendered by the layout without making the whole sidebar interactive.
 */
export function Sidebar({ dict, role, email }: { dict: Dictionary; role: Role; email: string }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <BrandBlock className="px-1" />
      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarNav dict={dict} role={role} email={email} />
      </div>
    </div>
  );
}

export { isManagementRoute, MANAGEMENT_PREFIXES } from "@/lib/nav/mode";
