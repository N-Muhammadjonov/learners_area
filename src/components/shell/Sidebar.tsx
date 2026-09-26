"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { BRAND } from "@/lib/config/brand";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { isAdministrator, isStaff, type Role } from "@/lib/auth/roles";
import { ReportProblem } from "@/components/support/ReportProblem";
import {
  IconAdmissions,
  IconAudit,
  IconChevronRight,
  IconContent,
  IconDashboard,
  IconGrammar,
  IconListening,
  IconLive,
  IconMocks,
  IconPeople,
  IconPlay,
  IconProgress,
  IconReading,
  IconRetention,
  IconSettings,
  IconSpeaking,
  IconSupport,
  IconTasks,
  IconVocabulary,
  IconWriting,
} from "@/components/ui/icons";

/**
 * Navigation — two modes, one tree.
 *
 * ---------------------------------------------------------------------------
 * Why there are two modes
 * ---------------------------------------------------------------------------
 *
 * An OWNER has access to everything, and the old sidebar drew that access
 * literally: student modules, teacher tools, an administrator block and an owner
 * block, all at once, in one column. The owner reported it as "too many items at
 * once", and they were right — access is not a layout decision. Learning and
 * running the centre are two different jobs, so they are two different modes:
 *
 *   LEARNING     the default. What a student sees, and what an owner sees while
 *                they are studying.
 *   MANAGEMENT   reached from the bottom of the learning sidebar. Contains the
 *                administration of the centre, grouped, and nothing else.
 *
 * The mode is derived from the route, not from a state variable, so a URL always
 * renders the same navigation — including after a hard refresh, and including
 * when someone pastes a management link into a new tab.
 *
 * Hiding an item is not authorization and this file never pretends it is: every
 * management route is enforced server-side by `requireStaff`,
 * `requireAdministrator` or `requireOwner`. What is drawn here is what the role
 * can actually open.
 *
 * ---------------------------------------------------------------------------
 * The `IELTS` item is gone
 * ---------------------------------------------------------------------------
 *
 * There used to be a top-level "IELTS" entry pointing at a course page, next to
 * the skill modules that *are* IELTS. Learners Area is an IELTS centre today;
 * labelling the course as a sibling of its own modules made the navigation read
 * like a course catalogue that does not exist. When SAT or IT actually ships,
 * that is when a real course switcher belongs here — not before.
 */

/** Routes that belong to running the centre rather than to studying in it. */
const MANAGEMENT_PREFIXES = ["/management", "/admin", "/owner", "/teacher"];

export function isManagementRoute(pathname: string): boolean {
  return MANAGEMENT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NavLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-sidebar-link={href}
      className={`group flex min-h-[46px] items-center gap-3 rounded-[10px] border px-3 text-[0.9375rem] leading-snug transition-colors ${
        active
          ? // Active is a raised card with a fine gold edge and cream text —
            // the centre's own language, not a copy of anyone's coloured pill.
            "border-gold/45 bg-paper-sunken font-semibold text-ink-900 shadow-card"
          : "border-transparent font-medium text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
      }`}
    >
      {icon && (
        <span
          aria-hidden
          className={`shrink-0 text-[21px] ${active ? "text-gold" : "text-ink-300 group-hover:text-ink-500"}`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </Link>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="mb-2 px-3 text-[0.75rem] font-semibold uppercase tracking-[0.09em] text-ink-300">
        {label}
      </p>
      <nav className="flex flex-col gap-1">{children}</nav>
    </div>
  );
}

/**
 * The compact brand block at the top of the sidebar and the mobile drawer.
 *
 * One component, so the two surfaces cannot drift apart. The product name is
 * real HTML text — an approved raster wordmark was never meant to be the label
 * for a navigation row, and text is what a screen reader, a translation and a
 * rename can all work with. The mark itself is the supplied artwork for the
 * current theme (BrandLogo, no recolouring).
 */
export function SidebarBrand({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={`flex flex-col gap-1.5 rounded-[10px] px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 ${className}`}
      data-sidebar-brand
    >
      {/* The name is right below as text, so the mark is decorative: a screen
          reader announces "Learners Area" once, not twice. */}
      <BrandLogo kind="mark" className="h-10" eager decorative />
      <span className="font-display text-[1.0625rem] leading-tight text-ink-900">{BRAND.siteName}</span>
      <span className="text-[0.75rem] leading-snug text-ink-300">{BRAND.brandLine}</span>
    </Link>
  );
}

/**
 * The complete navigation tree, exported once so the desktop sidebar and the
 * mobile drawer can never drift apart.
 *
 * No lock badge is drawn, on purpose. A lock would have to mean "the server will
 * refuse this", and the centre's real gates are role, account status and course
 * access — none of which can be read from a navigation row. Drawing one anyway
 * would be inventing a state; every link here is enforced on the server when it
 * is actually opened.
 */
export function SidebarNav({
  dict,
  role,
  onNavigate,
}: {
  dict: Dictionary;
  role: Role;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const management = isManagementRoute(pathname);
  const canManage = isStaff(role) || isAdministrator(role) || role === "owner";

  if (management) {
    return (
      <ManagementNav dict={dict} role={role} onNavigate={onNavigate} />
    );
  }

  return (
    <>
      <NavSection label={dict.nav.main}>
        <NavLink href="/dashboard" icon={<IconDashboard />} onNavigate={onNavigate}>
          {dict.nav.dashboard}
        </NavLink>
        <NavLink href="/live-classes" icon={<IconLive />} onNavigate={onNavigate}>
          {dict.nav.liveClasses}
        </NavLink>
        <NavLink href="/assignments" icon={<IconTasks />} onNavigate={onNavigate}>
          {dict.nav.assignments}
        </NavLink>
      </NavSection>

      {/*
        The section label is generic on purpose. Today every module is IELTS, but
        the navigation must not hard-code one course: when SAT, IT or General
        English content exists, its modules appear under the same label without
        touching this shell.
      */}
      <NavSection label={dict.nav.courseModules}>
        <NavLink href="/listening" icon={<IconListening />} onNavigate={onNavigate}>
          {dict.nav.listening}
        </NavLink>
        <NavLink href="/video-lessons" icon={<IconPlay />} onNavigate={onNavigate}>
          {dict.nav.videoLessons}
        </NavLink>
        <NavLink href="/reading" icon={<IconReading />} onNavigate={onNavigate}>
          {dict.nav.reading}
        </NavLink>
        <NavLink href="/writing" icon={<IconWriting />} onNavigate={onNavigate}>
          {dict.nav.writing}
        </NavLink>
        <NavLink href="/speaking" icon={<IconSpeaking />} onNavigate={onNavigate}>
          {dict.nav.speaking}
        </NavLink>
        <NavLink href="/grammar" icon={<IconGrammar />} onNavigate={onNavigate}>
          {dict.nav.grammar}
        </NavLink>
        <NavLink href="/vocabulary" icon={<IconVocabulary />} onNavigate={onNavigate}>
          {dict.nav.vocabulary}
        </NavLink>
      </NavSection>

      <NavSection label={dict.nav.track}>
        <NavLink href="/progress" icon={<IconProgress />} onNavigate={onNavigate}>
          {dict.nav.progress}
        </NavLink>
        <NavLink href="/mocks" icon={<IconMocks />} onNavigate={onNavigate}>
          {dict.nav.mocks}
        </NavLink>
      </NavSection>

      <NavSection label={dict.nav.bottom}>
        <NavLink href="/support" icon={<IconSupport />} onNavigate={onNavigate}>
          {dict.nav.support}
        </NavLink>
        {canManage && (
          // The one way into Management. Grouped with the utilities, visually
          // separated from the modules, and always at the same place.
          <NavLink href="/management" icon={<IconSettings />} onNavigate={onNavigate}>
            {dict.nav.management}
          </NavLink>
        )}
      </NavSection>
    </>
  );
}

/**
 * Management navigation.
 *
 * Grouped by what an administrator is doing, and gated by the same role checks
 * the routes themselves use — a TEACHER does not see People or Audit because
 * they cannot open them.
 */
function ManagementNav({
  dict,
  role,
  onNavigate,
}: {
  dict: Dictionary;
  role: Role;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link
        href="/dashboard"
        data-sidebar-back-to-learning
        className="mb-6 flex min-h-[46px] items-center gap-2.5 rounded-[10px] border border-gold/40 bg-gold/10 px-3 text-[0.9375rem] font-semibold text-ink-900 transition-colors hover:bg-gold/20"
      >
        <IconChevronRight className="rotate-180 text-[18px] text-gold" />
        {dict.nav.backToLearning}
      </Link>

      <p className="mb-3 px-3 text-[0.75rem] font-semibold uppercase tracking-[0.09em] text-ink-300">
        {dict.nav.management}
      </p>

      <NavSection label={dict.nav.people}>
        {isAdministrator(role) || role === "owner" ? (
          <>
            <NavLink href="/admin/people" icon={<IconPeople />} onNavigate={onNavigate}>
              {dict.nav.adminUsers}
            </NavLink>
            <NavLink href="/admin/admissions" icon={<IconAdmissions />} onNavigate={onNavigate}>
              {dict.admission.title}
            </NavLink>
          </>
        ) : null}
        {isStaff(role) && (
          <>
            <NavLink href="/teacher/students" icon={<IconPeople />} onNavigate={onNavigate}>
              {dict.nav.teacherStudents}
            </NavLink>
            <NavLink href="/teacher/support" icon={<IconSupport />} onNavigate={onNavigate}>
              {dict.support.inbox}
            </NavLink>
          </>
        )}
      </NavSection>

      <NavSection label={dict.nav.teaching}>
        <NavLink href="/teacher/live-classes" icon={<IconLive />} onNavigate={onNavigate}>
          {dict.liveClasses.manageTitle}
        </NavLink>
        <NavLink href="/teacher/speaking" icon={<IconSpeaking />} onNavigate={onNavigate}>
          {dict.speaking.manageTitle}
        </NavLink>
      </NavSection>

      {isAdministrator(role) && (
        <NavSection label={dict.nav.content}>
          <NavLink href="/admin/reading" icon={<IconReading />} onNavigate={onNavigate}>
            {dict.admin.readingTitle}
          </NavLink>
          <NavLink href="/admin/listening" icon={<IconListening />} onNavigate={onNavigate}>
            {dict.admin.listeningTitle}
          </NavLink>
          <NavLink href="/admin/grammar" icon={<IconGrammar />} onNavigate={onNavigate}>
            {dict.admin.grammarTitle}
          </NavLink>
          <NavLink href="/admin/writing-prompts" icon={<IconWriting />} onNavigate={onNavigate}>
            {dict.nav.adminPrompts}
          </NavLink>
          <NavLink href="/admin/video-lessons" icon={<IconPlay />} onNavigate={onNavigate}>
            {dict.videoLessonAdmin.title}
          </NavLink>
          <NavLink href="/admin/content" icon={<IconContent />} onNavigate={onNavigate}>
            {dict.nav.contentLibrary}
          </NavLink>
        </NavSection>
      )}

      {role === "owner" && (
        <NavSection label={dict.nav.owner}>
          <NavLink href="/owner" icon={<IconSettings />} onNavigate={onNavigate}>
            {dict.owner.title}
          </NavLink>
          <NavLink href="/owner/integrations" icon={<IconLink2 />} onNavigate={onNavigate}>
            {dict.owner.integrations}
          </NavLink>
          <NavLink href="/owner/retention" icon={<IconRetention />} onNavigate={onNavigate}>
            {dict.owner.retention}
          </NavLink>
          <NavLink href="/owner/audit" icon={<IconAudit />} onNavigate={onNavigate}>
            {dict.owner.audit}
          </NavLink>
          <NavLink href="/owner/transfer" icon={<IconPeople />} onNavigate={onNavigate}>
            {dict.owner.transfer}
          </NavLink>
        </NavSection>
      )}
    </>
  );
}

/** Small local alias so the integrations row reads as a link, not a file. */
function IconLink2({ className }: { className?: string }) {
  return <IconChevronRight className={className} />;
}

/**
 * Desktop persistent sidebar.
 *
 * `h-full` + `overflow-y-auto` is the whole point: the sidebar is exactly as
 * tall as the shell and scrolls inside itself. It cannot grow the document, so
 * its scrollbar can never move the passage the reader is working on.
 */
export function Sidebar({ dict, role }: { dict: Dictionary; role: Role }) {
  return (
    <aside
      data-shell-sidebar
      className="hidden h-full shrink-0 flex-col overflow-hidden border-r border-ink-100 bg-paper-raised md:flex"
      style={{ width: "var(--shell-sidebar-w)" }}
    >
      <div className="shrink-0 px-4 pb-4 pt-5">
        <SidebarBrand />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4"
        data-sidebar-scroll
      >
        <SidebarNav dict={dict} role={role} />
      </div>
      {/* Contextual: the report carries the page it was opened on. Pinned to the
          bottom of the column so it does not scroll away with the modules. */}
      <div className="shrink-0 border-t border-ink-100 px-3 py-3">
        <ReportProblem dict={dict} />
      </div>
    </aside>
  );
}
