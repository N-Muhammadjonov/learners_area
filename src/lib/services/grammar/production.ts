import { z } from "zod";

export const grammarPracticeSchema = z.object({
  activity: z.enum(["translate_it", "activate_it"]),
  answer: z.string().trim().min(2).max(2000),
}).strict();

/** The correction item's option is not an authored translation or activation
 * reference. Only the prompt for the requested activity may define its task. */
export function grammarPracticeEvidence(exercise: {
  translatePromptUz: string | null;
  activationPrompt: string | null;
  targetStructures: string[] | null;
}, activity: "translate_it" | "activate_it", topicTitle: string | null) {
  const promptText = (activity === "translate_it" ? exercise.translatePromptUz : exercise.activationPrompt)?.trim();
  if (!promptText) return null;
  const cues = (exercise.targetStructures ?? []).map(value => value.trim()).filter(Boolean);
  return {
    promptText,
    targetStructure: [topicTitle?.trim(), cues.length ? `Authored cues: ${cues.join(", ")}` : null].filter(Boolean).join("; ") || null,
    sampleAnswer: null,
  };
}
