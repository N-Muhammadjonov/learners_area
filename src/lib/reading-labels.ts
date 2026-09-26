/**
 * Names for the source's topic and question-type codes.
 *
 * These are IELTS terms, so they are translated for the interface but never
 * reworded: "True / False / Not Given" is what the exam calls it, and so is
 * "Matching Headings". A student who is told "Headinglarni moslash" and then
 * meets "Matching Headings" in the exam has been taught the wrong word.
 *
 * The codes are the source's own (see `scripts/import-reading-105.mjs`); a code
 * that is not in these tables is not guessed at — it is shown as it is.
 */

type Lang = "uz" | "en";

const TOPICS: Record<string, Record<Lang, string>> = {
  health: { uz: "Salomatlik", en: "Health" },
  nature: { uz: "Tabiat", en: "Nature" },
  language: { uz: "Til", en: "Language" },
  history: { uz: "Tarix", en: "History" },
  science: { uz: "Fan", en: "Science" },
  culture: { uz: "Madaniyat", en: "Culture" },
  business: { uz: "Biznes", en: "Business" },
  society: { uz: "Jamiyat", en: "Society" },
  env: { uz: "Atrof-muhit", en: "Environment" },
  psych: { uz: "Psixologiya", en: "Psychology" },
  tech: { uz: "Texnologiya", en: "Technology" },
  education: { uz: "Ta'lim", en: "Education" },
  general: { uz: "Umumiy", en: "General" },
};

const QUESTION_TYPES: Record<string, Record<Lang, string>> = {
  TFNG: { uz: "True / False / Not Given", en: "True / False / Not Given" },
  YNNG: { uz: "Yes / No / Not Given", en: "Yes / No / Not Given" },
  MCQ: { uz: "Ko'p tanlovli savol", en: "Multiple choice" },
  MCQ_MULTI: { uz: "Bir nechta harf tanlash", en: "Choose several letters" },
  MH: { uz: "Sarlavhalarni moslash", en: "Matching headings" },
  MI: { uz: "Ma'lumotni paragrafga moslash", en: "Matching information" },
  MF: { uz: "Xususiyatlarni moslash", en: "Matching features" },
  MSE: { uz: "Gap oxirini moslash", en: "Matching sentence endings" },
  NOTE: { uz: "Izohlarni to'ldirish", en: "Note completion" },
  SC: { uz: "Xulosani to'ldirish", en: "Summary completion" },
  SEN: { uz: "Gapni tugatish", en: "Sentence completion" },
  FLOW: { uz: "Jarayonni to'ldirish", en: "Flow-chart completion" },
  DIAG: { uz: "Diagrammani to'ldirish", en: "Diagram completion" },
  SAQ: { uz: "Qisqa javob", en: "Short answer" },
};

export function topicLabel(code: string | null | undefined, lang: Lang): string | null {
  if (!code) return null;
  return TOPICS[code]?.[lang] ?? code;
}

export function questionTypeLabel(code: string | null | undefined, lang: Lang): string | null {
  if (!code) return null;
  return QUESTION_TYPES[code]?.[lang] ?? code;
}

/** Every code this build knows how to name, in a stable order. */
export const KNOWN_TOPIC_CODES = Object.keys(TOPICS);
export const KNOWN_QUESTION_TYPE_CODES = Object.keys(QUESTION_TYPES);
