import { z } from "zod";

export const onboardingSchema = z.object({
  preferredLanguage: z.enum(["uz", "en"]),
  currentLevel: z.string().min(1).max(40),
  currentBand: z.coerce.number().min(0).max(9).optional(),
  targetBand: z.coerce.number().min(0).max(9),
  examDate: z.string().optional(),
  dailyStudyMinutes: z.coerce.number().int().min(5).max(600),
  strongestSkill: z.enum(["listening", "reading", "writing", "speaking"]),
  weakestSkill: z.enum(["listening", "reading", "writing", "speaking"]),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
