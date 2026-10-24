// Reviewed pure source link selection, no server dictionary calls.
import {READING_DESTINATIONS} from './reading-destinations.js';
export function navigationLinks({ module, dict }) {
    let links;
    if (module === "listening") {
        links = [
            { key: "lessons", href: "/app/listening/lessons", label: dict.listening.lessons.title },
            { key: "tests", href: "/app/listening/tests", label: dict.listening.academic.title },
            { key: "mcq", href: "/app/listening/mcq", label: dict.listening.mcqProgram.title },
        ];
    }
    else if (module === "reading") {
        links = READING_DESTINATIONS.map(key => ({ key, href: `/app/reading/${key}`, label: dict.readingV4.products[key].title }));
    }
    else if (module === "grammar") {
        links = [
            { key: "lessons", href: "/app/grammar/lessons", label: dict.grammar.lessonsTitle },
            { key: "writing", href: "/app/grammar?tab=writing", queryValue: "writing", label: dict.grammar.forWriting },
            { key: "speaking", href: "/app/grammar?tab=speaking", queryValue: "speaking", label: dict.grammar.forSpeaking },
        ];
    }
    else {
        links = ["words", "revision", "games", "use", "board", "dictionary"].map(key => ({
            key, label: dict.vocabulary.tab[key],
            href: key === "games" ? "/app/vocabulary/games" : key === "words" ? "/app/vocabulary" : `/app/vocabulary?tab=${key}`,
            ...(key === "games" ? {} : { queryValue: key, defaultQuery: key === "words" }),
        }));
    }
    return links;
}
