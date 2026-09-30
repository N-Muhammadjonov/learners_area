"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/roles";
import { isStaff } from "@/lib/auth/roles";
import { IconChevronDown, IconSettings } from "@/components/ui/icons";
import { ConfirmAction } from "@/components/interaction/InteractionPrimitives";

/**
 * The profile menu.
 *
 * A real menu with a real label, not an avatar that reveals itself on hover: a
 * touch screen has no hover, and a keyboard user cannot hover either. Click
 * opens it, Escape and outside clicks close it, and the button reports its own
 * state with `aria-expanded`.
 *
 * It shows the account's name and role — the two things a person actually wants
 * to confirm — and the way back into Management for the roles that have one.
 * No identity numbers, no session data, nothing that should not be on a screen
 * in a room.
 */
export function ProfileMenu({
  dict,
  userName,
  userEmail,
  role,
}: {
  dict: Dictionary;
  userName: string;
  userEmail: string | null;
  role: Role;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const roleLabels: Record<Role, string> = {
    student: dict.roles.student,
    teacher: dict.roles.teacher,
    admin: dict.roles.admin,
    owner: dict.roles.owner,
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-profile-menu-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 items-center gap-2 rounded-[10px] border border-ink-100 pl-1 pr-2 text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-100 text-[0.875rem] font-semibold text-signal-700">
          {userName.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-[9rem] truncate text-[0.875rem] font-medium lg:inline">{userName}</span>
        <IconChevronDown className="hidden text-[14px] lg:inline" />
      </button>

      {open && (
        <div
          role="menu"
          data-profile-menu
          className="absolute right-0 top-[calc(100%+0.5rem)] w-60 overflow-hidden rounded-[14px] border border-ink-100 bg-paper-raised shadow-raised"
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <div className="border-b border-ink-100 px-3.5 py-3">
            <p className="truncate text-[0.9375rem] font-medium text-ink-900">{userName}</p>
            {userEmail && <p className="truncate text-[0.8125rem] text-ink-300">{userEmail}</p>}
            <p className="mt-1.5 inline-flex rounded-full border border-gold/45 px-2 py-0.5 text-[0.75rem] font-medium text-ink-700">
              {roleLabels[role]}
            </p>
          </div>
          <div className="p-1.5">
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-[44px] items-center gap-2.5 rounded-[10px] px-2.5 text-[0.9375rem] text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900"
            >
              {dict.nav.profile}
            </Link>
            {isStaff(role) && (
              <Link
                href="/management"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center gap-2.5 rounded-[10px] px-2.5 text-[0.9375rem] text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900"
              >
                <IconSettings className="text-[18px] text-ink-300" />
                {dict.shell.switchToManagement}
              </Link>
            )}
            <ConfirmAction
              trigger={dict.nav.logout}
              triggerRole="menuitem"
              triggerClassName="flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[0.9375rem] text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900"
              title={dict.auth.signOutConfirmTitle}
              description={dict.auth.signOutConfirmBody}
              confirmLabel={dict.auth.signOut}
              cancelLabel={dict.common.cancel}
              pendingLabel={dict.loadingPage.label}
              failureMessage={dict.auth.errorServer}
              onConfirm={async () => {
                const response = await fetch("/api/auth/logout", { method: "POST" });
                if (!response.ok) throw new Error("Logout was not confirmed by the server");
                setOpen(false);
                router.replace("/login");
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
