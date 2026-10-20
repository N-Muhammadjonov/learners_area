import type { Dictionary } from "@/lib/i18n/en";
import type { ModuleSectionLink } from "@/components/navigation/ModuleSectionNav";

export function vocabularySection(pathname: string, tab: string | null) {
  if (pathname === "/app/vocabulary/games" || pathname.startsWith("/app/vocabulary/games/")) return "games";
  if (pathname !== "/app/vocabulary") return null;
  return tab === "revision" || tab === "use" || tab === "board" || tab === "dictionary" ? tab : "words";
}

export function vocabularySectionLinks(dict: Dictionary): ModuleSectionLink[] {
  return (["words", "revision", "games", "use", "board", "dictionary"] as const).map(key => ({
    key, label: dict.vocabulary.tab[key],
    href: key === "games" ? "/app/vocabulary/games" : key === "words" ? "/app/vocabulary" : `/app/vocabulary?tab=${key}`,
    ...(key === "games" ? {} : { queryValue: key, defaultQuery: key === "words" }),
  }));
}
