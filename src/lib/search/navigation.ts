import en, { type Dictionary } from "@/lib/i18n/en";
import uz from "@/lib/i18n/uz";
import { moduleSectionLinks, type HeaderModule } from "@/lib/nav/module-sections";
import { SPEAKING_HUB_CARDS } from "@/lib/speaking/hub";
import { WRITING_TABS } from "@/lib/writing/tabs";

export type SearchHit = { type: string; title: string; context: string | null; href: string };
const modules: HeaderModule[] = ["listening", "reading", "writing", "grammar", "vocabulary", "video-lessons"];
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, " ").trim();

/** Search both interface languages, displaying the visitor's selected language.
 * Destinations come from the same route registry as the header tabs. */
export function navigationSearch(query: string, dict: Dictionary): SearchHit[] {
  const entries = (labels: Dictionary): SearchHit[] => [
    ...modules.map(module => ({type: "module", title: module === "video-lessons" ? labels.nav.videoLessons : labels.nav[module], context: null, href: `/app/${module}`})),
    {type: "module", title: labels.nav.speaking, context: null, href: "/app/speaking"},
    ...modules.flatMap(module => moduleSectionLinks(labels, module).map(link => ({type: "section", title: link.label, context: module === "video-lessons" ? labels.nav.videoLessons : labels.nav[module], href: link.href}))),
    ...WRITING_TABS.map(tab => ({type: "section", title: labels.writingWorkspace.tabs[tab], context: labels.nav.writing, href: `/app/writing?tab=${tab}`})),
    ...SPEAKING_HUB_CARDS.map(card => ({type: "section", title: labels.speakingHub.cards[card.key].title, context: labels.nav.speaking, href: card.href})),
  ];
  const needle = normalized(query);
  if (needle.length < 2) return [];
  const aliases = [entries(en), entries(uz)];
  return entries(dict).filter(hit => aliases.some(list => list.some(alias => alias.href === hit.href && normalized(`${alias.title} ${alias.context ?? ""}`).includes(needle))));
}

export function rankSearchHits(hits: SearchHit[], query: string, limit = 30): SearchHit[] {
  const needle = normalized(query);
  const score = (hit: SearchHit) => {
    const title = normalized(hit.title);
    return title === needle ? 0 : title.startsWith(needle) ? 1 : 2;
  };
  const unique = [...new Map(hits.map(hit => [`${hit.type}:${hit.href}:${hit.title}`, hit])).values()];
  return unique.sort((a,b) => score(a)-score(b) || a.title.length-b.title.length || a.href.localeCompare(b.href)).slice(0,limit);
}
