import { lemmaNorm, partOfSpeechNorm, lexicalTypeFor } from "@/lib/text/lexical-normalize";

/**
 * Inflected surface forms of a lexical unit (pure; deterministic).
 *
 * This is MORPHOLOGY, not meaning: it says that "ran" is a form of "run". It
 * never says which sense of "run" a text uses — that stays on the occurrence.
 * Every generated form is labelled by how it was produced (`form_type`), so a
 * regular-rule form is distinguishable from an authored one.
 *
 * Irregular forms come from the table below, never from a rule. A verb missing
 * from the table only gets regular forms; a wrong guess such as "runned" is
 * impossible for any verb that IS in the table, because the table wins.
 */

export type FormType = "lemma" | "regular" | "irregular";
export type GeneratedForm = { form: string; formNorm: string; formType: FormType };

/** base → [past simple, past participle]. Extend by authoring, never by guessing. */
const IRREGULAR_VERBS: Record<string, [string, string]> = {
  be: ["was", "been"], become: ["became", "become"], begin: ["began", "begun"], break: ["broke", "broken"],
  bring: ["brought", "brought"], build: ["built", "built"], buy: ["bought", "bought"], catch: ["caught", "caught"],
  choose: ["chose", "chosen"], come: ["came", "come"], cost: ["cost", "cost"], cut: ["cut", "cut"],
  do: ["did", "done"], draw: ["drew", "drawn"], drink: ["drank", "drunk"], drive: ["drove", "driven"],
  eat: ["ate", "eaten"], fall: ["fell", "fallen"], feel: ["felt", "felt"], find: ["found", "found"],
  fly: ["flew", "flown"], forget: ["forgot", "forgotten"], get: ["got", "got"], give: ["gave", "given"],
  go: ["went", "gone"], grow: ["grew", "grown"], have: ["had", "had"], hear: ["heard", "heard"],
  hold: ["held", "held"], keep: ["kept", "kept"], know: ["knew", "known"], lead: ["led", "led"],
  leave: ["left", "left"], lend: ["lent", "lent"], let: ["let", "let"], lose: ["lost", "lost"],
  make: ["made", "made"], mean: ["meant", "meant"], meet: ["met", "met"], pay: ["paid", "paid"],
  put: ["put", "put"], read: ["read", "read"], ride: ["rode", "ridden"], rise: ["rose", "risen"],
  run: ["ran", "run"], say: ["said", "said"], see: ["saw", "seen"], sell: ["sold", "sold"],
  send: ["sent", "sent"], set: ["set", "set"], shed: ["shed", "shed"], show: ["showed", "shown"],
  sit: ["sat", "sat"], sleep: ["slept", "slept"], speak: ["spoke", "spoken"], spend: ["spent", "spent"],
  stand: ["stood", "stood"], take: ["took", "taken"], teach: ["taught", "taught"], tell: ["told", "told"],
  think: ["thought", "thought"], throw: ["threw", "thrown"], understand: ["understood", "understood"],
  wake: ["woke", "woken"], wear: ["wore", "worn"], win: ["won", "won"], write: ["wrote", "written"],
};

/** singular → plural for nouns the regular rule gets wrong. */
const IRREGULAR_NOUNS: Record<string, string> = {
  child: "children", person: "people", man: "men", woman: "women", foot: "feet", tooth: "teeth",
  mouse: "mice", goose: "geese", phenomenon: "phenomena", criterion: "criteria", analysis: "analyses",
  crisis: "crises", thesis: "theses", datum: "data",
};

// Authored degree forms for adverbs that also occur as adjective heads. This
// admits "rose higher" as a form of adverb high; it does not choose a sense.
const ADVERB_DEGREE_FORMS: Record<string, string[]> = {
  high: ["higher", "highest"],
  low: ["lower", "lowest"],
  long: ["longer", "longest"],
};
const ADJECTIVE_DEGREE_FORMS: Record<string, string[]> = {
  high: ["higher", "highest"],
  low: ["lower", "lowest"],
  old: ["older", "oldest"],
};

const VOWEL = /[aeiou]/;

function vowelGroups(word: string): number {
  return (word.match(/[aeiouy]+/g) ?? []).length;
}

function thirdPerson(verb: string): string {
  if (/(s|x|z|ch|sh|o)$/.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

/** Double the final consonant only for one-syllable consonant-vowel-consonant verbs (run → running). */
function doublesFinal(verb: string): boolean {
  return vowelGroups(verb) === 1 && /[^aeiou][aeiou][^aeiouwxy]$/.test(verb);
}

function presentParticiple(verb: string): string {
  if (/ie$/.test(verb)) return `${verb.slice(0, -2)}ying`;
  if (/[^aeiou]e$/.test(verb) && verb !== "be" && verb.length > 2) return `${verb.slice(0, -1)}ing`;
  if (doublesFinal(verb)) return `${verb}${verb.at(-1)}ing`;
  return `${verb}ing`;
}

function regularPast(verb: string): string {
  if (/e$/.test(verb)) return `${verb}d`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;
  if (doublesFinal(verb)) return `${verb}${verb.at(-1)}ed`;
  return `${verb}ed`;
}

function plural(noun: string): string {
  const irregular = IRREGULAR_NOUNS[noun];
  if (irregular) return irregular;
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

function verbForms(verb: string): { form: string; formType: FormType }[] {
  const irregular = IRREGULAR_VERBS[verb];
  const forms: { form: string; formType: FormType }[] = [
    { form: thirdPerson(verb), formType: "regular" },
    { form: presentParticiple(verb), formType: "regular" },
  ];
  if (irregular) {
    forms.push({ form: irregular[0], formType: "irregular" }, { form: irregular[1], formType: "irregular" });
  } else if (VOWEL.test(verb)) {
    forms.push({ form: regularPast(verb), formType: "regular" });
  }
  return forms;
}

/**
 * All surface forms of a unit, the lemma first. Verb phrases and phrasal verbs
 * inflect their HEAD (first) word: "shed pounds" → "sheds pounds", "shedding
 * pounds"; "take into account" → "took into account".
 */
export function formsOf(term: string, partOfSpeech: string | null | undefined): GeneratedForm[] {
  const lemma = lemmaNorm(term);
  const pos = partOfSpeechNorm(partOfSpeech);
  const type = lexicalTypeFor(term, partOfSpeech);
  const out = new Map<string, GeneratedForm>();
  const add = (form: string, formType: FormType) => {
    const formNorm = lemmaNorm(form);
    if (formNorm && !out.has(formNorm)) out.set(formNorm, { form, formNorm, formType });
  };
  add(lemma, "lemma");
  if (!lemma || /[^a-z' -]/.test(lemma)) return [...out.values()];
  const words = lemma.split(" ");
  const head = words[0]!;
  const rest = words.slice(1).join(" ");
  const join = (first: string) => (rest ? `${first} ${rest}` : first);
  const verbal = pos === "verb" || type === "verb_phrase" || type === "phrasal_verb";
  if (verbal) for (const f of verbForms(head)) add(join(f.form), f.formType);
  else if (pos === "noun" && words.length === 1) add(plural(lemma), IRREGULAR_NOUNS[lemma] ? "irregular" : "regular");
  else if ((pos === "adjective" || pos === "a") && words.length === 1)
    for (const form of ADJECTIVE_DEGREE_FORMS[lemma] ?? []) add(form, "regular");
  else if ((pos === "adverb" || pos === "r") && words.length === 1)
    for (const form of ADVERB_DEGREE_FORMS[lemma] ?? []) add(form, "regular");
  return [...out.values()];
}
