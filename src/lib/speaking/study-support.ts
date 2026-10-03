import { z } from "zod";

export const speakingWordSchema = z.object({
  term: z.string().trim().min(1).max(120),
  definitionEn: z.string().trim().min(1).max(500),
  translationUz: z.string().trim().max(500).default(""),
  partOfSpeech: z.string().trim().max(30).default(""),
  exampleSentence: z.string().trim().max(500).default(""),
});
export const studySupportSchema = z.object({
  vocabularyHtml: z.string().max(100000).default(""),
  modelAnswerHtml: z.string().max(100000).default(""),
  ideasHtml: z.string().max(100000).default(""),
  vocabulary: z.array(speakingWordSchema).max(100).default([]),
});
export type SpeakingStudySupport = z.infer<typeof studySupportSchema>;
export const speakingPromptDraft = z.object({
  id: z.string().uuid().optional(),
  part: z.enum(["part1", "part2", "part3"]),
  topic: z.string().trim().min(1).max(200),
  promptText: z.string().trim().min(1).max(200),
  cueCard: z.string().max(12000).default(""),
  followUps: z.array(z.string().trim().min(1).max(2000)).max(20).default([]),
  availableIn: z.array(z.enum(["practice_alone", "live_partner", "ai"])).min(1).max(3),
  studySupport: studySupportSchema,
});

/** Practice and Partner share one bank; helpers stay on its single row. */
export function sharedSpeakingChannels(channels: string[]): string[] {
  return [...new Set(channels.some(channel => channel === "practice_alone" || channel === "live_partner") ? [...channels, "practice_alone", "live_partner"] : channels)];
}
export const usesSharedSpeakingBank = (channels: string[]) => channels.includes("practice_alone") || channels.includes("live_partner");
