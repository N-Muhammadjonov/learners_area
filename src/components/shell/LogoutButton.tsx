"use client";

import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { ConfirmAction } from "@/components/interaction/InteractionPrimitives";

export function LogoutButton({ label, dict }: { label: string; dict: Dictionary }) {
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={label}
      triggerClassName="btn-ghost"
      title={dict.auth.signOutConfirmTitle}
      description={dict.auth.signOutConfirmBody}
      confirmLabel={dict.auth.signOut}
      cancelLabel={dict.common.cancel}
      pendingLabel={dict.loadingPage.label}
      failureMessage={dict.auth.errorServer}
      onConfirm={async () => {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error("Logout was not confirmed by the server");
        router.replace("/login");
        router.refresh();
      }}
    />
  );
}
