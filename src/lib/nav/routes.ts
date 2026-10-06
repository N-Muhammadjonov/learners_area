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
  { prefix: "/app/reading/retention", build: (d) => [{ label: d.nav.reading, href: "/app/reading" }, { label: d.retentionMemory.title, href: "/app/reading/retention" }] },
  { prefix: "/app/reading/history", build: (d) => [{ label: d.nav.reading, href: "/app/reading" }, { label: d.reading.historyTitle, href: "/app/reading/history" }] },
  { prefix: "/app/reading/passages", build: (d) => [{ label: d.nav.reading, href: "/app/reading" }, { label: d.reading.pickPassage, href: "/app/reading" }] },
  { prefix: "/app/reading/attempts", build: (d) => [{ label: d.nav.reading, href: "/app/reading" }, { label: d.reading.analysisTitle, href: "/app/reading" }] },
  { prefix: "/app/reading", exact: true, build: (d) => [{ label: d.nav.reading, href: "/app/reading" }] },

  // Academic Listening: the catalogue, then one test's hub. The hub's last crumb names
  // the catalogue, so a reader who arrived from a link always has a way back up.
  { prefix: "/app/listening/academic/", build: (d) => [{ label: d.nav.listening, href: "/app/listening" }, { label: d.listening.academic.title, href: "/app/listening/academic" }] },
  { prefix: "/app/listening/academic", build: (d) => [{ label: d.nav.listening, href: "/app/listening" }, { label: d.listening.academic.title, href: "/app/listening/academic" }] },
  { prefix: "/app/listening/history", build: (d) => [{ label: d.nav.listening, href: "/app/listening" }, { label: d.listening.historyTitle, href: "/app/listening/history" }] },
  { prefix: "/app/listening/attempts", build: (d) => [{ label: d.nav.listening, href: "/app/listening" }, { label: d.listening.analysisTitle, href: "/app/listening" }] },
  { prefix: "/app/listening", exact: true, build: (d) => [{ label: d.nav.listening, href: "/app/listening" }] },

  { prefix: "/app/writing/history", build: (d) => [{ label: d.nav.writing, href: "/app/writing" }, { label: d.writing.historyTitle, href: "/app/writing/history" }] },
  { prefix: "/app/writing/submissions", build: (d) => [{ label: d.nav.writing, href: "/app/writing" }, { label: d.writing.feedbackTitle, href: "/app/writing" }] },
  { prefix: "/app/writing", exact: true, build: (d) => [{ label: d.nav.writing, href: "/app/writing" }] },

  { prefix: "/app/speaking/practice", build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }, { label: d.speakingPractice.title, href: "/app/speaking/practice" }] },
  { prefix: "/app/speaking/history", build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }, { label: d.speakingPractice.historyTitle, href: "/app/speaking/history" }] },
  { prefix: "/app/speaking/ai", build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }, { label: d.speakingHub.cards.ai.title, href: "/app/speaking/ai" }] },
  { prefix: "/app/speaking/lessons", build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }, { label: d.speakingHub.lessonsTitle, href: "/app/speaking/lessons" }] },
  { prefix: "/app/speaking/live-partner", build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }, { label: d.livePartner.title, href: "/app/speaking/live-partner" }] },
  { prefix: "/app/speaking/shadowing", build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }, { label: d.speakingHub.lessonsTitle, href: "/app/speaking/lessons" }, { label: d.speakingShadowing.title, href: "/app/speaking/shadowing" }] },
  { prefix: "/app/speaking", exact: true, build: (d) => [{ label: d.nav.speaking, href: "/app/speaking" }] },

  { prefix: "/app/grammar", exact: true, build: (d) => [{ label: d.nav.grammar, href: "/app/grammar" }] },
  { prefix: "/app/grammar/", build: (d) => [{ label: d.nav.grammar, href: "/app/grammar" }, { label: d.grammar.practiceTitle, href: "/app/grammar" }] },

  { prefix: "/app/vocabulary/review", build: (d) => [{ label: d.nav.vocabulary, href: "/app/vocabulary" }, { label: d.vocabulary.review, href: "/app/vocabulary/review" }] },
  { prefix: "/app/vocabulary", exact: true, build: (d) => [{ label: d.nav.vocabulary, href: "/app/vocabulary" }] },

  { prefix: "/app/video-lessons", exact: true, build: (d) => [{ label: d.nav.videoLessons, href: "/app/video-lessons" }] },
  { prefix: "/app/video-lessons/", build: (d) => [{ label: d.nav.videoLessons, href: "/app/video-lessons" }, { label: d.videoLesson.playbackNote, href: "/app/video-lessons" }] },

  { prefix: "/app/courses", build: (d) => [{ label: d.nav.courseModules, href: "/app/courses/ielts" }, { label: d.nav.course, href: "/app/courses/ielts" }] },

  { prefix: "/app/assignments", exact: true, build: (d) => [{ label: d.nav.assignments, href: "/app/assignments" }] },
  { prefix: "/app/assignments/", build: (d) => [{ label: d.nav.assignments, href: "/app/assignments" }, { label: d.assignments.title, href: "/app/assignments" }] },

  { prefix: "/app/mocks", exact: true, build: (d) => [{ label: d.nav.mocks, href: "/app/mocks" }] },
  { prefix: "/app/mocks/", build: (d) => [{ label: d.nav.mocks, href: "/app/mocks" }, { label: d.mocks.catalogue, href: "/app/mocks" }] },

  { prefix: "/app/reports", exact: true, build: (d) => [{ label: d.reporter.title, href: "/app/reports" }] },
  { prefix: "/app/progress", exact: true, build: (d) => [{ label: d.nav.progress, href: "/app/progress" }] },
  { prefix: "/app/live-classes", exact: true, build: (d) => [{ label: d.nav.liveClasses, href: "/app/live-classes" }] },
  { prefix: "/app/notifications", exact: true, build: (d) => [{ label: d.notifications.title, href: "/app/notifications" }] },
  { prefix: "/app/support", exact: true, build: (d) => [{ label: d.nav.support, href: "/app/support" }] },
  { prefix: "/app/coach", exact: true, build: (d) => [{ label: d.nav.coach, href: "/app/coach" }] },
  { prefix: "/onboarding", exact: true, build: (d) => [{ label: d.onboarding.title, href: "/onboarding" }] },

  { prefix: "/app/management", exact: true, build: (d) => [{ label: d.nav.management, href: "/app/management" }] },

  { prefix: "/app/teacher/students", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.nav.teacherStudents, href: "/app/teacher/students" }] },
  { prefix: "/app/teacher/support", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.support.inbox, href: "/app/teacher/support" }] },
  { prefix: "/app/teacher/live-classes", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.liveClasses.manageTitle, href: "/app/teacher/live-classes" }] },
  { prefix: "/app/teacher/speaking", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.speaking.manageTitle, href: "/app/teacher/speaking" }] },

  // The materials editor is nested under Management like every other admin
  // screen: without this entry the topbar renders neither a crumb nor a Back
  // button, and a reader who opens it from a link has no way up.
  { prefix: "/app/admin/materials", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.materialsTitle, href: "/app/admin/materials" }] },
  { prefix: "/app/admin/roster", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.reporter.roster.title, href: "/app/admin/roster" }] },
  { prefix: "/app/admin/people", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.nav.adminUsers, href: "/app/admin/people" }] },
  { prefix: "/app/admin/admissions", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admission.title, href: "/app/admin/admissions" }] },
  { prefix: "/app/admin/content", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.nav.contentLibrary, href: "/app/admin/content" }] },
  { prefix: "/app/admin/reading/retention", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.readingTitle, href: "/app/admin/reading" }, { label: d.retentionMemory.admin.title, href: "/app/admin/reading/retention" }] },
  { prefix: "/app/admin/reading", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.readingTitle, href: "/app/admin/reading" }] },
  { prefix: "/app/admin/listening", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.listeningTitle, href: "/app/admin/listening" }] },
  { prefix: "/app/admin/grammar", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.grammarTitle, href: "/app/admin/grammar" }] },
  // Legacy alias (redirects to /admin/writing?section=exam); kept so old bookmarks still have a parent.
  { prefix: "/app/admin/writing-prompts", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.writingAdmin.title, href: "/app/admin/writing" }] },
  { prefix: "/app/admin/writing", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.admin.writingAdmin.title, href: "/app/admin/writing" }] },
  { prefix: "/app/admin/video-lessons", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.videoLessonAdmin.title, href: "/app/admin/video-lessons" }] },

  { prefix: "/app/owner/dictionary", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.owner.title, href: "/app/owner" }, { label: d.globalDictionary.owner, href: "/app/owner/dictionary" }] },
  { prefix: "/app/owner/integrations", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.owner.integrations, href: "/app/owner/integrations" }] },
  { prefix: "/app/owner/retention", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.owner.retention, href: "/app/owner/retention" }] },
  { prefix: "/app/owner/audit", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.owner.audit, href: "/app/owner/audit" }] },
  { prefix: "/app/owner/transfer", build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.owner.transfer, href: "/app/owner/transfer" }] },
  { prefix: "/app/owner", exact: true, build: (d) => [{ label: d.nav.management, href: "/app/management" }, { label: d.owner.title, href: "/app/owner" }] },
];

/** Longest matching prefix wins, so `/app/reading/attempts/x` never matches `/app/reading`. */
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
