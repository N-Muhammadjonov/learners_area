"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Role } from "@/lib/auth/roles";

export function RoleSelect({
  userId,
  currentRole,
  options,
}: {
  userId: string;
  currentRole: Role;
  /** Roles the current actor may actually grant (server decides again). */
  options: Role[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <select
      className="input w-32 text-xs"
      defaultValue={currentRole}
      disabled={pending}
      onChange={async (e) => {
        setPending(true);
        await fetch(`/api/admin/users/${userId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: e.target.value }),
        });
        setPending(false);
        router.refresh();
      }}
    >
      {options.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}
