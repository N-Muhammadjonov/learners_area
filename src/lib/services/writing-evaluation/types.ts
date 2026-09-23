export type WritingTaskType = "task1" | "task2";

export type EvaluationInput = {
  taskType: WritingTaskType;
  prompt: string;
  content: string;
  targetWordCount: number;
};

export type EvaluationResult = {
  taskResponseBand: number;
  coherenceBand: number;
  lexicalBand: number;
  grammarBand: number;
  overallBand: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
};

export interface WritingEvaluationService {
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
