import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/session";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center rounded-sm px-3 py-2 text-sm text-ink-700 hover:bg-paper-sunken hover:text-ink-900"
    >
      {children}
    </Link>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-ink-300">
        {label}
      </p>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

export function Sidebar({ dict, role }: { dict: Dictionary; role: Role }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-100 bg-paper-raised p-4 md:flex">
      <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-signal-600 font-display text-sm text-white">
          L
        </span>
        <span className="font-display text-lg text-ink-900">{dict.marketing.title}</span>
      </Link>

      <NavSection label="Main">
        <NavLink href="/dashboard">{dict.nav.dashboard}</NavLink>
        <NavLink href="/live-classes">{dict.nav.liveClasses}</NavLink>
      </NavSection>

      <NavSection label={dict.nav.course}>
        <NavLink href="/listening">{dict.nav.listening}</NavLink>
        <NavLink href="/reading">{dict.nav.reading}</NavLink>
        <NavLink href="/writing">{dict.nav.writing}</NavLink>
        <NavLink href="/speaking">{dict.nav.speaking}</NavLink>
        <NavLink href="/grammar">{dict.nav.grammar}</NavLink>
        <NavLink href="/vocabulary">{dict.nav.vocabulary}</NavLink>
      </NavSection>

      <NavSection label="Track">
        <NavLink href="/mocks">{dict.nav.mocks}</NavLink>
        <NavLink href="/progress">{dict.nav.progress}</NavLink>
      </NavSection>

      {(role === "teacher" || role === "admin") && (
        <NavSection label={dict.nav.teacher}>
          <NavLink href="/teacher/students">{dict.nav.teacherStudents}</NavLink>
          <NavLink href="/teacher/live-classes">{dict.liveClasses.manageTitle}</NavLink>
          <NavLink href="/teacher/speaking">{dict.speaking.manageTitle}</NavLink>
        </NavSection>
      )}

      {role === "admin" && (
        <NavSection label={dict.nav.admin}>
          <NavLink href="/admin/users">{dict.nav.adminUsers}</NavLink>
          <NavLink href="/admin/writing-prompts">{dict.nav.adminPrompts}</NavLink>
          <NavLink href="/admin/reading">{dict.admin.readingTitle}</NavLink>
          <NavLink href="/admin/listening">Listening tests</NavLink>
          <NavLink href="/admin/grammar">{dict.admin.grammarTitle}</NavLink>
        </NavSection>
      )}
    </aside>
  );
}
