import {normalizeLexical} from "@/lib/text/lexical-normalize";

/** Limited spelling variants only. Never strip semantic prefixes (un-/non-),
 * particles or a hyphen by concatenation: re-sign and resign are different. */
export function dictionarySpellingVariants(word:string) {
 const term=normalizeLexical(word),terms=new Set([term]);
 if(term.endsWith("'s")&&term.length>3)terms.add(term.slice(0,-2));
 for(const item of [...terms])if(item.includes("-"))terms.add(item.replaceAll("-"," "));
 return [...terms];
}
