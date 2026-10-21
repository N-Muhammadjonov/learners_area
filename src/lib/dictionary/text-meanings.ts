import "server-only";
import { activeRelease, entriesByIds, searchDictionary } from "./store";
import { normalizeSearch } from "./model";
import {dictionarySpellingVariants} from "./spelling-variants";
import { dictionaryPos } from "./labels";
import { dictionaryPresentation } from "./presentation";
import type { SensePresentation } from "./presentation-types";

export type TextDictionaryMeaning = {
  lexemeId: string; senseId: string; term: string; partOfSpeech: string;
  definitionEn: string; translationUz: string; ipa: string | null;
  study?: SensePresentation;
};

/** Catalogue candidates supply study material to an exact authored meaning.
 * Course text popovers never expose this list or choose a spelling's first hit. */
export async function textDictionaryMeanings(word: string) {
  const {active_release_id: releaseId} = await activeRelease();
  const variants=dictionarySpellingVariants(word);
  const primary=await searchDictionary(variants[0]!,"EN",releaseId);
  const hits=(primary.some(hit=>hit.match_type!=="prefix") ? primary : (await Promise.all(variants.slice(1).map(term=>searchDictionary(term,"EN",releaseId)))).flat()).filter(hit=>hit.match_type!=="prefix");
  const entries = await entriesByIds([...new Set(hits.map(hit=>hit.lexeme_id))],releaseId);
  const norms=new Set(variants.map(normalizeSearch)), choices:TextDictionaryMeaning[]=[];
  for (const entry of entries.values()) {
    if (!norms.has(normalizeSearch(entry.display_lemma)) && !entry.forms.some(form=>norms.has(normalizeSearch(form.surface_form)))) continue;
    const presentation = dictionaryPresentation(entry);
    for (const sense of entry.senses) choices.push({lexemeId:entry.lexeme_id,senseId:sense.sense_id,term:entry.display_lemma,
      partOfSpeech:dictionaryPos(entry.part_of_speech),definitionEn:sense.definition_en,
      translationUz:sense.translations.map(t=>t.text).join(", "),ipa:entry.pronunciations[0]?.ipa??null,
      study:presentation.senses[sense.sense_id]});
  }
  return {releaseId,choices};
}

/** Add study material to an already authored contextual meaning, never pick a
 * different sense or let a catalogue failure hide the course's own definition. */
export function matchingContextMeaning(choices:TextDictionaryMeaning[], authored:{id:string;term:string;definitionEn:string;partOfSpeech:string|null}) {
  const exact = choices.filter(choice => normalizeSearch(choice.term)===normalizeSearch(authored.term)
    && normalizeSearch(choice.definitionEn)===normalizeSearch(authored.definitionEn)
    && (!authored.partOfSpeech || dictionaryPos(choice.partOfSpeech)===dictionaryPos(authored.partOfSpeech)));
  return exact.find(choice=>choice.senseId===authored.id) ?? (exact.length===1 ? exact[0] : undefined);
}
