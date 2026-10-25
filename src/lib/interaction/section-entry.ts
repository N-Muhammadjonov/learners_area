import type { Dictionary } from "@/lib/i18n/en";

export type EntryFrameShape =
  | "dashboard"
  | "classes"
  | "assignments"
  | "list"
  | "reading"
  | "writing"
  | "speaking"
  | "grammar"
  | "vocabulary"
  | "progress"
  | "mocks"
  | "management"
  | "simple";

export type EntryFrameModel = {
  title: string;
  subtitle?: string;
  shape: EntryFrameShape;
  tabs?: string[];
};

export type EntryFrames = Record<string, EntryFrameModel>;

/** Stable, localized destination identity. No data access is performed here. */
export function sectionEntryFrames(dict: Dictionary): EntryFrames {
  return {
    dashboard: { title: dict.nav.dashboard, subtitle: dict.nav.course, shape: "dashboard" },
    "course-roadmap": { title: dict.nav.course, subtitle: dict.dashboard.fullRoadmap, shape: "simple" },
    coach: { title: dict.coach.dashboardTitle, subtitle: dict.coach.dashboardSubtitle, shape: "simple" },
    notifications: { title: dict.notifications.title, shape: "simple" },
    "live-classes": { title: dict.liveClasses.title, subtitle: dict.liveClasses.upcoming, shape: "classes" },
    assignments: { title: dict.assignments.title, subtitle: dict.assignments.subtitle, shape: "assignments" },
    listening: { title: dict.listening.practiceTitle, shape: "list" },
    "video-lessons": { title: dict.videoLessons.title, subtitle: dict.videoLessons.intro, shape: "list" },
    reading: { title: dict.readingHub.title, subtitle: dict.readingHub.subtitle, shape: "reading", tabs: [dict.readingV4.products.lessons.title, dict.readingV4.products.academic.title, dict.readingV4.products.general.title, dict.readingV4.products["question-types"].title, dict.readingV4.products.retention.title] },
    writing: { title: dict.writing.practiceTitle, shape: "writing" },
    speaking: { title: dict.speaking.title, shape: "speaking" },
    grammar: { title: dict.grammar.title, subtitle: dict.grammar.subtitle, shape: "grammar" },
    vocabulary: { title: dict.vocabulary.title, subtitle: dict.vocabulary.search.hint, shape: "vocabulary", tabs: [dict.vocabulary.tab.words, dict.vocabulary.tab.revision, dict.vocabulary.tab.games, dict.vocabulary.tab.use, dict.vocabulary.tab.board] },
    progress: { title: dict.nav.progress, subtitle: dict.progress.subtitle, shape: "progress" },
    mocks: { title: dict.nav.mockTests, subtitle: dict.mocks.subtitle, shape: "mocks" },
    support: { title: dict.support.title, subtitle: dict.support.subtitle, shape: "simple" },
    management: { title: dict.management.title, subtitle: dict.management.subtitle, shape: "management" },
    other: { title: dict.shell.management, shape: "simple" },
  };
}
