"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/roles";
import { ConfirmSelect } from "@/components/interaction/InteractionPrimitives";

export function RoleSelect({
  userId,
  currentRole,
  options,
  dict,
}: {
  userId: string;
  currentRole: Role;
  /** Roles the current actor may actually grant (server decides again). */
  options: Role[];
  dict: Dictionary;
}) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();

  return (
    <ConfirmSelect
      className="input w-32 text-xs"
      value={currentRole}
      ariaLabel={dict.people.role}
      options={options.map((role) => ({ value: role, label: role }))}
      title={dict.people.confirmRoleTitle}
      description={dict.people.confirmRoleBody}
      confirmLabel={dict.common.confirm}
      cancelLabel={dict.common.cancel}
      pendingLabel={dict.loadingPage.label}
      failureMessage={dict.people.failed}
      onConfirm={async (role) => {
        const response = await requestResponse(`/api/admin/users/${userId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });
    if (!response) return;
        if (!response.ok) throw new Error("role_change_failed");
        router.refresh();
      }}
    />
  );
}
