/**
 * Shared types for the Vocabulary section.
 *
 * They mirror the engine's return shapes but are declared here so a client
 * component never imports the server-only engine module. Dates arrive as ISO
 * strings after a JSON round-trip and as `Date` on the first paint, so the
 * components normalise with `new Date(...)` at the edge.
 */

export type Mastery = "new" | "learning" | "known" | "active" | "mastered";

export type VocabWord = {
  id: string;
  term: string;
  partOfSpeech: string | null;
  definitionEn: string;
  translationUz: string | null;
  exampleSentence: string | null;
  mastery: Mastery;
  srsStage: number;
  intervalDays: number;
  nextReviewAt: string | Date;
  correctCount: number;
  incorrectCount: number;
  activeUseCount: number;
  folderId: string | null;
  topicPack: string | null;
  sourceType: string | null;
  createdAt: string | Date;
};

export type VocabFolder = { id: string; name: string; count: number };

export type VocabPack = { id: string; label: string; wordCount: number };

export type VocabStanding = {
  points: number;
  rank: number;
  streak: number;
  top: { rank: number; userId: string; name: string; points: number; isMe: boolean }[];
};

export type VocabAward = {
  id: string;
  kind: "new_word" | "revision" | "game_answer" | "sentence";
  points: number;
  createdAt: string | Date;
};

export type VocabSentence = {
  id: string;
  sentence: string;
  origin: "manual" | "riwi";
  accepted: boolean;
  pointsAwarded: number;
  term: string;
  evaluationId: string | null;
  createdAt: string | Date;
};

export type VocabStudioData = {
  words: VocabWord[];
  due: VocabWord[];
  folders: VocabFolder[];
  summary: {
    total: number;
    due: number;
    byMastery: Record<string, number>;
    nextDueAt: string | Date | null;
  };
  standing: VocabStanding;
  sentences: VocabSentence[];
  packs: VocabPack[];
  initialTab: TabKey;
};

export type TabKey = "words" | "revision" | "games" | "use" | "board";

/** A meaning-side prompt used by the games — never the answer itself. */
export type GameWord = {
  id: string;
  term: string;
  definitionEn: string;
  translationUz: string | null;
  exampleSentence: string | null;
  partOfSpeech: string | null;
  mastery: Mastery;
  intervalDays: number;
  nextReviewAt: string | Date;
};

export type GameSetKey =
  | "all"
  | "due"
  | "weak"
  | "reading"
  | "listening"
  | "topic"
  | "folder"
  | "assigned";

export type GameSetResponse = {
  key: GameSetKey;
  label: string;
  words: GameWord[];
  count: number;
  due: number;
  topicPack?: string | null;
  folderId?: string | null;
};

export type GameAnswerResponse = { awarded: number; srsUntouched: true };

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function isDue(word: { nextReviewAt: string | Date }): boolean {
  return toDate(word.nextReviewAt).getTime() <= Date.now();
}
