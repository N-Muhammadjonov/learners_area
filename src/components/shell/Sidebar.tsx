"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { BRAND } from "@/lib/config/brand";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { isAdministrator, isStaff, type Role } from "@/lib/auth/roles";
import { ReportProblem } from "@/components/support/ReportProblem";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-sm px-3 py-2 text-sm ${
        active
          ? // The active item is a raised card in the centre's own language:
            // a lifted surface, a fine gold edge and cream text. Not a coloured
            // pill borrowed from anywhere else.
            "border border-gold/40 bg-paper-sunken font-medium text-ink-900 shadow-card"
          : "border border-transparent text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
      }`}
    >
      {children}
    </Link>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

/**
 * The compact brand block at the top of the sidebar and the mobile drawer.
 *
 * One component so the two surfaces cannot drift apart. It shows the supplied
 * mark for the current theme (via BrandLogo — no recolouring), the product name
 * and the centre's line under it. The mark is eager-loaded: it is above the fold
 * on every page of the application.
 */
export function SidebarBrand({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={`flex flex-col gap-1 rounded-sm px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 ${className}`}
      data-sidebar-brand
    >
      {/* The name is right here as text, so the mark is decorative: a screen
          reader announces "Learners Area" once, not twice. */}
      <BrandLogo kind="mark" className="h-9" eager decorative />
      <span className="font-display text-base leading-tight text-ink-900">{BRAND.siteName}</span>
      <span className="text-xs leading-snug text-ink-300">{BRAND.brandLine}</span>
    </Link>
  );
}

/**
 * The complete navigation tree, exported once so the desktop sidebar and the
 * mobile drawer can never drift apart. See MobileNav for the small-screen
 * surface; this component is the desktop one.
 *
 * Grouping is by what the reader is doing, not by which page happens to exist:
 * HOME is the daily start, COURSE & MODULES is the IELTS skill work, PRACTICE &
 * PROGRESS is the measuring, and the staff and owner groups appear only for the
 * roles that may use them.
 *
 * No lock badge is drawn here, on purpose. A lock would have to mean "the server
 * will refuse this", and the centre's real gates are role, account status and
 * course access — none of which can be read from a navigation row. Drawing one
 * anyway would be inventing a state; every one of these links is enforced
 * server-side when it is actually opened.
 */
export function SidebarNav({ dict, role }: { dict: Dictionary; role: Role }) {
  return (
    <>
      <NavSection label={dict.nav.main}>
        <NavLink href="/dashboard">{dict.nav.dashboard}</NavLink>
        <NavLink href="/live-classes">{dict.nav.liveClasses}</NavLink>
        <NavLink href="/coach">{dict.nav.coach}</NavLink>
        <NavLink href="/assignments">{dict.nav.assignments}</NavLink>
      </NavSection>

      {/*
        The section label is generic on purpose. Today every module is IELTS, but
        the navigation must not hard-code one course: when SAT, IT or General
        English content exists, its modules appear under the same label without
        touching this shell.
      */}
      <NavSection label={dict.nav.courseModules}>
        <NavLink href="/courses/ielts">{dict.nav.course}</NavLink>
        <NavLink href="/listening">{dict.nav.listening}</NavLink>
        <NavLink href="/video-lessons">{dict.nav.videoLessons}</NavLink>
        <NavLink href="/reading">{dict.nav.reading}</NavLink>
        <NavLink href="/writing">{dict.nav.writing}</NavLink>
        <NavLink href="/speaking">{dict.nav.speaking}</NavLink>
        <NavLink href="/grammar">{dict.nav.grammar}</NavLink>
        <NavLink href="/vocabulary">{dict.nav.vocabulary}</NavLink>
      </NavSection>

      <NavSection label={dict.nav.track}>
        <NavLink href="/speaking/practice">{dict.speakingPractice.title}</NavLink>
        <NavLink href="/speaking/history">{dict.speakingPractice.historyTitle}</NavLink>
        <NavLink href="/mocks">{dict.nav.mocks}</NavLink>
        <NavLink href="/progress">{dict.nav.progress}</NavLink>
      </NavSection>

      {isStaff(role) && (
        <NavSection label={dict.nav.teacher}>
          <NavLink href="/teacher/students">{dict.nav.teacherStudents}</NavLink>
          <NavLink href="/teacher/live-classes">{dict.liveClasses.manageTitle}</NavLink>
          <NavLink href="/teacher/speaking">{dict.speaking.manageTitle}</NavLink>
          <NavLink href="/teacher/support">{dict.support.inbox}</NavLink>
        </NavSection>
      )}

      {isAdministrator(role) && (
        <NavSection label={dict.nav.admin}>
          <NavLink href="/admin/admissions">{dict.admission.title}</NavLink>
          <NavLink href="/admin/people">{dict.nav.adminUsers}</NavLink>
          <NavLink href="/admin/writing-prompts">{dict.nav.adminPrompts}</NavLink>
          <NavLink href="/admin/reading">{dict.admin.readingTitle}</NavLink>
          <NavLink href="/admin/listening">{dict.admin.listeningTitle}</NavLink>
          <NavLink href="/admin/grammar">{dict.admin.grammarTitle}</NavLink>
          <NavLink href="/admin/video-lessons">{dict.videoLessonAdmin.title}</NavLink>
        </NavSection>
      )}

      {role === "owner" && (
        <NavSection label={dict.nav.owner}>
          <NavLink href="/owner">{dict.owner.title}</NavLink>
          <NavLink href="/owner/integrations">{dict.owner.integrations}</NavLink>
          <NavLink href="/owner/retention">{dict.owner.retention}</NavLink>
          <NavLink href="/owner/audit">{dict.owner.audit}</NavLink>
          <NavLink href="/owner/transfer">{dict.owner.transfer}</NavLink>
        </NavSection>
      )}
    </>
  );
}

/** Desktop persistent sidebar. The mobile equivalent is MobileNav. */
export function Sidebar({ dict, role }: { dict: Dictionary; role: Role }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-ink-100 bg-paper-raised p-4 md:flex">
      <SidebarBrand className="mb-6" />
      <div className="flex min-h-0 flex-1 flex-col justify-between">
        <SidebarNav dict={dict} role={role} />
        {/* Contextual: the report carries the page it was opened on. */}
        <ReportProblem dict={dict} />
      </div>
    </aside>
  );
}
