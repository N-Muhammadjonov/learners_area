import { Suspense } from "react";
import { getDictionary, getLocale } from "@/lib/i18n";
import { READING_DESTINATIONS } from "@/lib/reading/destinations";
import { ModuleSectionNav, type ModuleSectionLink } from "./ModuleSectionNav";

type Module = "listening" | "reading" | "grammar" | "vocabulary";

export async function ModuleNavigation({ module }: { module: Module }) {
  const dict = getDictionary(await getLocale());
  let links: ModuleSectionLink[];
  if (module === "listening") {
    links = [
      { key: "lessons", href: "/app/listening/lessons", label: dict.listening.lessons.title },
      { key: "academic", href: "/app/listening/academic", label: dict.listening.academic.title },
      { key: "mcq", href: "/app/listening/mcq", label: dict.listening.mcqProgram.title },
    ];
  } else if (module === "reading") {
    links = READING_DESTINATIONS.map(key => ({ key, href: `/app/reading/${key}`, label: dict.readingV4.products[key].title }));
  } else if (module === "grammar") {
    links = [
      { key: "lessons", href: "/app/grammar/lessons", label: dict.grammar.lessonsTitle },
      { key: "writing", href: "/app/grammar?tab=writing", queryValue: "writing", label: dict.grammar.forWriting },
      { key: "speaking", href: "/app/grammar?tab=speaking", queryValue: "speaking", label: dict.grammar.forSpeaking },
    ];
  } else {
    links = (["words", "revision", "games", "use", "board", "dictionary"] as const).map(key => ({
      key, label: dict.vocabulary.tab[key],
      href: key === "games" ? "/app/vocabulary/games" : key === "words" ? "/app/vocabulary" : `/app/vocabulary?tab=${key}`,
      ...(key === "games" ? {} : { queryValue: key, defaultQuery: key === "words" }),
    }));
  }
  return <Suspense fallback={<div className="h-12 border-b border-ink-100" aria-hidden="true" />}>
    <ModuleSectionNav module={module} label={dict.nav[module]} links={links} />
  </Suspense>;
}
