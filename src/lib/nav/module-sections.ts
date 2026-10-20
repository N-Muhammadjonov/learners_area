import type { Dictionary } from "@/lib/i18n/en";
import type { ModuleSectionLink } from "@/components/navigation/ModuleSectionNav";
import { READING_DESTINATIONS } from "@/lib/reading/destinations";
import { parseWritingTab } from "@/lib/writing/tabs";
import { vocabularySection, vocabularySectionLinks } from "./vocabulary";

export type HeaderModule = "listening" | "reading" | "grammar" | "writing" | "vocabulary" | "video-lessons";
export function headerModule(path: string): HeaderModule | null {
  return (["listening", "reading", "grammar", "writing", "vocabulary", "video-lessons"] as const)
    .find(module => path === `/app/${module}` || path.startsWith(`/app/${module}/`)) ?? null;
}

export function moduleSectionLinks(dict: Dictionary, module: HeaderModule): ModuleSectionLink[] {
  if (module === "vocabulary") return vocabularySectionLinks(dict);
  if (module === "reading") return READING_DESTINATIONS.map(key => ({key, href: `/app/reading/${key}`, label: dict.readingV4.products[key].title}));
  if (module === "listening") return [
    {key: "lessons", href: "/app/listening/lessons", label: dict.listening.lessons.title},
    {key: "tests", href: "/app/listening/tests", label: dict.listening.academic.title},
    {key: "mcq", href: "/app/listening/mcq", label: dict.listening.mcqProgram.title},
  ];
  if (module === "grammar") return [
    {key: "lessons", href: "/app/grammar/lessons", label: dict.grammar.lessonsTitle},
    {key: "writing", href: "/app/grammar?tab=writing", queryValue: "writing", label: dict.grammar.forWriting},
    {key: "speaking", href: "/app/grammar?tab=speaking", queryValue: "speaking", label: dict.grammar.forSpeaking},
  ];
  return [];
}

/** Resolve labels from the existing real routes; nested content keeps its own h1. */
export function headerSection(path: string, tab: string | null, dict: Dictionary) {
  const activeModule = headerModule(path);
  if (!activeModule) return null;
  if (activeModule === "video-lessons") return {module: activeModule, key: "library", title: dict.videoLessons.standaloneHeading, index: path === "/app/video-lessons"};
  if (activeModule === "vocabulary") {
    const key = vocabularySection(path, tab);
    return key ? {module: activeModule, key, title: dict.vocabulary.tab[key], index: path === "/app/vocabulary" || path === "/app/vocabulary/games"} : null;
  }
  if (activeModule === "writing") {
    const segment = path.split("/")[3];
    const key = path === "/app/writing" ? parseWritingTab(tab ?? undefined)
      : segment === "lessons" || segment === "exam" || segment === "translation" || segment === "language-stealing" || segment === "grade" ? segment : null;
    return key ? {module: activeModule, key, title: dict.writingWorkspace.tabs[key], index: path === "/app/writing"} : null;
  }
  if (activeModule === "grammar" && path === "/app/grammar") {
    const key = tab === "speaking" ? "speaking" : "writing";
    return {module: activeModule, key, title: key === "speaking" ? dict.grammar.forSpeaking : dict.grammar.forWriting, index: true};
  }
  const links = moduleSectionLinks(dict, activeModule);
  const normalized = path === "/app/listening/academic" ? "/app/listening/tests" : path;
  const link = links.find(item => normalized === item.href || normalized.startsWith(item.href + "/"));
  return link ? {module: activeModule, key: link.key, title: link.label, index: normalized === link.href} : null;
}
