"use client";

import { ModuleEmoji, moduleEmojiFor } from "@/components/ui/ModuleEmoji";
import { InstantLink } from "@/components/interaction/InstantLink";
import { LinkPending } from "./LinkPending";
import { usePathname } from "next/navigation";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/roles";
import { isManagementRoute } from "@/lib/nav/mode";
import {
  IconAdmissions,
  IconAssignments,
  IconAudit,
  IconContent,
  IconDashboard,
  IconGrammar,
  IconListening,
  IconLive,
  IconPeople,
  IconProgress,
  IconReading,
  IconSparkles,
  IconSettings,
  IconSpeaking,
  IconSupport,
  IconVideo,
  IconVocabulary,
  IconWriting,
} from "@/components/ui/icons";

/**
 * The navigation list, in one of two modes.
 *
 * It is a client component because it needs the current path and pending
 * navigation intent to mark the active row and choose the mode immediately.
 * Everything it renders is a real link — navigation works before hydration,
 * in a new tab, and to a screen reader.
 */

type NavItem = { href: string; label: string; icon: React.ReactNode };

function Group({ title, items, pathname, loading }: { title: string; items: NavItem[]; pathname: string; loading: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="sidebar-group">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <InstantLink
                href={item.href}
                intentPrefetch
                data-sidebar-link={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "sidebar-link sidebar-link-active" : "sidebar-link"}
              >
                <span aria-hidden className="sidebar-link-icon">
                  {moduleEmojiFor(item.href) ? <ModuleEmoji kind={moduleEmojiFor(item.href)!} /> : item.icon}
                </span>
                <span className="sidebar-link-label">{item.label}</span>
                <LinkPending label={loading} />
              </InstantLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SidebarNav({ dict, role, email, riwiEnabled = false }: { dict: Dictionary; role: Role; email?: string; riwiEnabled?: boolean }) {
  const pathname = usePathname() ?? "/";
  const { navigation, currentLocation } = useInstantInteraction();
  const pendingPath = navigation && currentLocation === navigation.from ? navigation.to.split("?")[0] : null;
  const activePath = pendingPath ?? pathname;
  const nav = dict.nav;
  const staff = role === "teacher" || role === "admin" || role === "owner";
  const management = isManagementRoute(activePath);

  const learning: NavItem[] = [
    { href: "/dashboard", label: nav.dashboard, icon: <IconDashboard /> },
    { href: "/live-classes", label: nav.liveClasses, icon: <IconLive /> },
    { href: "/assignments", label: nav.assignments, icon: <IconAssignments /> },
    ...(riwiEnabled ? [{ href: "/riwi", label: nav.riwi, icon: <IconSparkles /> }] : []),
  ];

  /*
   * The module list, and the IELTS row that is not here.
   *
   * The whole centre teaches IELTS today, so a top-level "IELTS" entry beside
   * Listening and Reading promised a course switcher that does not exist —
   * there is nothing to switch to. When SAT or IT is really added, the course
   * row belongs here, above the modules; until then there is one course and it
   * does not need a name.
   */
  const modules: NavItem[] = [
    { href: "/listening", label: nav.listening, icon: <IconListening /> },
    { href: "/video-lessons", label: nav.videoLessons, icon: <IconVideo /> },
    { href: "/reading", label: nav.reading, icon: <IconReading /> },
    { href: "/writing", label: nav.writing, icon: <IconWriting /> },
    { href: "/speaking", label: nav.speaking, icon: <IconSpeaking /> },
    { href: "/grammar", label: nav.grammar, icon: <IconGrammar /> },
    { href: "/vocabulary", label: nav.vocabulary, icon: <IconVocabulary /> },
  ];

  const progress: NavItem[] = [
    { href: "/progress", label: nav.progress, icon: <IconProgress /> },
    { href: "/mocks", label: nav.mockTests, icon: <IconProgress /> },
  ];

  const managementItems: NavItem[] = [];
  if (role === "admin" || role === "owner") {
    managementItems.push(
      { href: "/admin/people", label: nav.people, icon: <IconPeople /> },
      { href: "/admin/admissions", label: nav.admissions, icon: <IconAdmissions /> }
    );
  }
  if (staff) {
    managementItems.push(
      { href: "/teacher/students", label: nav.teacherStudents, icon: <IconPeople /> },
      { href: "/teacher/support", label: nav.supportInbox, icon: <IconSupport /> },
      { href: "/teacher/live-classes", label: nav.manageLiveClasses, icon: <IconLive /> },
      { href: "/teacher/speaking", label: nav.manageSpeaking, icon: <IconSpeaking /> }
    );
  }
  if (role === "admin" || role === "owner") {
    managementItems.push({ href: "/admin/content", label: nav.contentLibrary, icon: <IconContent /> });
  }
  if (role === "owner") {
    managementItems.push(
      { href: "/owner", label: nav.ownerTools, icon: <IconSettings /> },
      { href: "/owner/audit", label: nav.auditLog, icon: <IconAudit /> }
    );
  }

  return (
    <nav className="flex h-full flex-col" aria-label={management ? dict.shell.managementNav : dict.shell.learningNav} data-pending-route={pendingPath ?? undefined}>
      {management ? (
        <div className="flex flex-col gap-3 pb-4">
          <InstantLink href="/dashboard" className="sidebar-back" data-sidebar-back-to-learning>
            <span aria-hidden>←</span>
            {nav.backToLearning}
          </InstantLink>
          <p className="sidebar-mode">{dict.shell.managementMode}</p>
          <Group title={dict.shell.management} items={managementItems} pathname={activePath} loading={dict.common.loading} />
        </div>
      ) : (
        <div className="flex flex-col gap-6 pb-4">
          <Group title={nav.groupMain} items={learning} pathname={activePath} loading={dict.common.loading} />
          <Group title={nav.groupModules} items={modules} pathname={activePath} loading={dict.common.loading} />
          <Group title={nav.groupProgress} items={progress} pathname={activePath} loading={dict.common.loading} />
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3 border-t border-ink-100 pt-4">
        <Group title={dict.shell.support} items={[{ href: "/support", label: nav.support, icon: <IconSupport /> }]} pathname={activePath} loading={dict.common.loading} />
        {staff && !management && (
          <InstantLink href="/management" className="sidebar-link sidebar-link-management" data-sidebar-management-entry>
            <span aria-hidden className="sidebar-link-icon">
              <IconSettings />
            </span>
            <span className="sidebar-link-label">{dict.shell.switchToManagement}</span>
          </InstantLink>
        )}
        {email && (
          <p className="sidebar-account" title={email}>
            {email}
          </p>
        )}
      </div>
    </nav>
  );
}
