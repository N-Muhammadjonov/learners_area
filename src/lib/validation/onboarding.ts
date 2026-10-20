import { z } from "zod";

export const onboardingSchema = z.object({
  preferredLanguage: z.enum(["uz", "en"]),
  currentLevel: z.string().min(1).max(40),
  currentBand: z.coerce.number().min(0).max(9).multipleOf(.5).optional(),
  targetBand: z.coerce.number().min(0).max(9).multipleOf(.5),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(value+'T00:00:00.000Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;},'Invalid calendar date').optional(),
  dailyStudyMinutes: z.coerce.number().int().min(5).max(600),
  strongestSkill: z.enum(["listening", "reading", "writing", "speaking"]),
  weakestSkill: z.enum(["listening", "reading", "writing", "speaking"]),
}).strict();

export type OnboardingInput = z.infer<typeof onboardingSchema>;
