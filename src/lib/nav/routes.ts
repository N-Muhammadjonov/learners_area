import type { Dictionary } from "@/lib/i18n/en";

/**
 * Where am I, and how do I get back?
 *
 * The topbar needs to answer both questions for every page, and a "Back" button
 * that relies on browser history cannot answer the second one: a reader who
 * arrived from a search result, or opened a link in a new tab, has no history to
 * go back to. So every nested route declares its parent here, in one table, and
 * the back button always goes somewhere real.
 *
 * Routes are matched most-specific-first. A route that is not in the table is
 * treated as top-level: no back button, no breadcrumb, and the sidebar already
 * shows which module is open.
 */

export type Crumb = { label: string; href: string };

type Entry = {
  /** Path prefix this entry describes. */
  prefix: string;
  /** True when the prefix is the whole route (no detail page). */
  exact?: boolean;
  build: (dict: Dictionary, pathname: string) => Crumb[];
};

/**
 * Labels for the segments that appear inside a dynamic route. Kept as a small
 * map rather than a generic capitaliser: "attempts" should never be shown to a
 * reader, and a machine-generated label would be.
 */
const ENTRIES: Entry[] = [
  { prefix: "/reading/retention", build: (d) => [{ label: d.nav.reading, href: "/reading" }, { label: d.retentionMemory.title, href: "/reading/retention" }] },
  { prefix: "/reading/history", build: (d) => [{ label: d.nav.reading, href: "/reading" }, { label: d.reading.historyTitle, href: "/reading/history" }] },
  { prefix: "/reading/passages", build: (d) => [{ label: d.nav.reading, href: "/reading" }, { label: d.reading.pickPassage, href: "/reading" }] },
  { prefix: "/reading/attempts", build: (d) => [{ label: d.nav.reading, href: "/reading" }, { label: d.reading.analysisTitle, href: "/reading" }] },
  { prefix: "/reading", exact: true, build: (d) => [{ label: d.nav.reading, href: "/reading" }] },

  { prefix: "/listening/history", build: (d) => [{ label: d.nav.listening, href: "/listening" }, { label: d.listening.historyTitle, href: "/listening/history" }] },
  { prefix: "/listening/attempts", build: (d) => [{ label: d.nav.listening, href: "/listening" }, { label: d.listening.analysisTitle, href: "/listening" }] },
  { prefix: "/listening", exact: true, build: (d) => [{ label: d.nav.listening, href: "/listening" }] },

  { prefix: "/writing/history", build: (d) => [{ label: d.nav.writing, href: "/writing" }, { label: d.writing.historyTitle, href: "/writing/history" }] },
  { prefix: "/writing/submissions", build: (d) => [{ label: d.nav.writing, href: "/writing" }, { label: d.writing.feedbackTitle, href: "/writing" }] },
  { prefix: "/writing", exact: true, build: (d) => [{ label: d.nav.writing, href: "/writing" }] },

  { prefix: "/speaking/practice", build: (d) => [{ label: d.nav.speaking, href: "/speaking" }, { label: d.speakingPractice.title, href: "/speaking/practice" }] },
  { prefix: "/speaking/history", build: (d) => [{ label: d.nav.speaking, href: "/speaking" }, { label: d.speakingPractice.historyTitle, href: "/speaking/history" }] },
  { prefix: "/speaking", exact: true, build: (d) => [{ label: d.nav.speaking, href: "/speaking" }] },

  { prefix: "/grammar", exact: true, build: (d) => [{ label: d.nav.grammar, href: "/grammar" }] },
  { prefix: "/grammar/", build: (d) => [{ label: d.nav.grammar, href: "/grammar" }, { label: d.grammar.practiceTitle, href: "/grammar" }] },

  { prefix: "/vocabulary/review", build: (d) => [{ label: d.nav.vocabulary, href: "/vocabulary" }, { label: d.vocabulary.review, href: "/vocabulary/review" }] },
  { prefix: "/vocabulary", exact: true, build: (d) => [{ label: d.nav.vocabulary, href: "/vocabulary" }] },

  { prefix: "/video-lessons", exact: true, build: (d) => [{ label: d.nav.videoLessons, href: "/video-lessons" }] },
  { prefix: "/video-lessons/", build: (d) => [{ label: d.nav.videoLessons, href: "/video-lessons" }, { label: d.videoLesson.playbackNote, href: "/video-lessons" }] },

  { prefix: "/courses", build: (d) => [{ label: d.nav.courseModules, href: "/courses/ielts" }, { label: d.nav.course, href: "/courses/ielts" }] },

  { prefix: "/assignments", exact: true, build: (d) => [{ label: d.nav.assignments, href: "/assignments" }] },
  { prefix: "/assignments/", build: (d) => [{ label: d.nav.assignments, href: "/assignments" }, { label: d.assignments.title, href: "/assignments" }] },

  { prefix: "/mocks", exact: true, build: (d) => [{ label: d.nav.mocks, href: "/mocks" }] },
  { prefix: "/mocks/", build: (d) => [{ label: d.nav.mocks, href: "/mocks" }, { label: d.mocks.catalogue, href: "/mocks" }] },

  { prefix: "/progress", exact: true, build: (d) => [{ label: d.nav.progress, href: "/progress" }] },
  { prefix: "/live-classes", exact: true, build: (d) => [{ label: d.nav.liveClasses, href: "/live-classes" }] },
  { prefix: "/notifications", exact: true, build: (d) => [{ label: d.notifications.title, href: "/notifications" }] },
  { prefix: "/support", exact: true, build: (d) => [{ label: d.nav.support, href: "/support" }] },
  { prefix: "/coach", exact: true, build: (d) => [{ label: d.nav.coach, href: "/coach" }] },
  { prefix: "/onboarding", exact: true, build: (d) => [{ label: d.onboarding.title, href: "/onboarding" }] },

  { prefix: "/management", exact: true, build: (d) => [{ label: d.nav.management, href: "/management" }] },

  { prefix: "/teacher/students", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.nav.teacherStudents, href: "/teacher/students" }] },
  { prefix: "/teacher/support", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.support.inbox, href: "/teacher/support" }] },
  { prefix: "/teacher/live-classes", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.liveClasses.manageTitle, href: "/teacher/live-classes" }] },
  { prefix: "/teacher/speaking", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.speaking.manageTitle, href: "/teacher/speaking" }] },

  { prefix: "/admin/people", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.nav.adminUsers, href: "/admin/people" }] },
  { prefix: "/admin/admissions", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.admission.title, href: "/admin/admissions" }] },
  { prefix: "/admin/content", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.nav.contentLibrary, href: "/admin/content" }] },
  { prefix: "/admin/reading/retention", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.admin.readingTitle, href: "/admin/reading" }, { label: d.retentionMemory.admin.title, href: "/admin/reading/retention" }] },
  { prefix: "/admin/reading", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.admin.readingTitle, href: "/admin/reading" }] },
  { prefix: "/admin/listening", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.admin.listeningTitle, href: "/admin/listening" }] },
  { prefix: "/admin/grammar", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.admin.grammarTitle, href: "/admin/grammar" }] },
  { prefix: "/admin/writing-prompts", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.nav.adminPrompts, href: "/admin/writing-prompts" }] },
  { prefix: "/admin/video-lessons", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.videoLessonAdmin.title, href: "/admin/video-lessons" }] },

  { prefix: "/owner/integrations", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.owner.integrations, href: "/owner/integrations" }] },
  { prefix: "/owner/retention", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.owner.retention, href: "/owner/retention" }] },
  { prefix: "/owner/audit", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.owner.audit, href: "/owner/audit" }] },
  { prefix: "/owner/transfer", build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.owner.transfer, href: "/owner/transfer" }] },
  { prefix: "/owner", exact: true, build: (d) => [{ label: d.nav.management, href: "/management" }, { label: d.owner.title, href: "/owner" }] },
];

/** Longest matching prefix wins, so `/reading/attempts/x` never matches `/reading`. */
export function breadcrumbsFor(pathname: string, dict: Dictionary): Crumb[] {
  const matches = ENTRIES.filter((entry) =>
    entry.exact ? pathname === entry.prefix : pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
  );
  if (matches.length === 0) return [];
  matches.sort((a, b) => b.prefix.length - a.prefix.length);
  const best = matches[0];
  return best ? best.build(dict, pathname) : [];
}

/** The parent a Back button should go to, or null when there is no parent. */
export function parentFor(pathname: string, dict: Dictionary): Crumb | null {
  const crumbs = breadcrumbsFor(pathname, dict);
  if (crumbs.length === 0) return null;
  // The current page is the last crumb; its parent is the one before it, or the
  // module root when the page is the module's own child.
  const last = crumbs[crumbs.length - 1];
  if (!last) return null;
  if (crumbs.length === 1 && last.href === pathname) return null;
  return crumbs[crumbs.length - (last.href === pathname ? 2 : 1)] ?? null;
}
