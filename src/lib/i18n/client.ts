import en, { type Dictionary } from "./en";
import uz from "./uz";

/**
 * The dictionary, on the client.
 *
 * `src/lib/i18n/index.ts` reads the locale cookie through `next/headers`, so it
 * cannot be imported into a client component. Error boundaries and not-found
 * screens *are* client components (the boundary needs `reset`), and they still
 * have to speak the reader's language — an Uzbek reader must not be handed an
 * English-only "Something went wrong".
 *
 * The locale is already known to the client: the root layout writes it onto
 * `<html lang>`. Reading it from there keeps one source of truth and needs no
 * extra request, no cookie parsing in the browser and no context provider.
 */
const dictionaries: Record<string, Dictionary> = { en, uz };

export function dictionaryForDocument(): Dictionary {
  if (typeof document === "undefined") return en;
  return dictionaries[document.documentElement.lang] ?? en;
}

export type { Dictionary };
