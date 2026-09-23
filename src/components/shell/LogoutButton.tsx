"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
