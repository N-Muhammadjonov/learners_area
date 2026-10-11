import { z } from "zod";

export const INSTRUCTION_RUNTIME_KEYS = ["tutoring.simple-explanation", "tutoring.compare-concepts", "grammar.explanation"] as const;
export type InstructionTaskKey = (typeof INSTRUCTION_RUNTIME_KEYS)[number];
export const instructionTaskSchema = z.enum(INSTRUCTION_RUNTIME_KEYS);
export const teachingContractSchema = z.object({
  key: instructionTaskSchema, version: z.string().min(1).max(80), rubricVersion: z.string().min(1).max(80),
  instructionSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type TeachingContract = z.infer<typeof teachingContractSchema>;
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const conceptSchema = z.object({ name: text(120), explanation: text(700), example: text(400) }).strict();
export const instructionTeachingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grammar_explanation"), rule: text(500), contrast: text(600),
    examples: z.array(text(400)).min(2).max(3), commonError: text(500), checkQuestion: text(300) }).strict(),
  z.object({ kind: z.literal("simple_explanation"), answer: text(200), explanation: text(1200),
    example: text(500), illustration: text(600), checkQuestion: text(300) }).strict(),
  z.object({ kind: z.literal("compare_concepts"), conceptA: conceptSchema, conceptB: conceptSchema,
    keyDifference: text(600), commonConfusion: text(600) }).strict(),
]);
export type InstructionTeaching = z.infer<typeof instructionTeachingSchema>;
