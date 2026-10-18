import "server-only";
import catalogue from "./original-mcq-catalogue.json";

/** Explicit source identity and authored position, never a display title. */
export function originalMcqAudioUrl(sourceId: string | null, day: number, question: number): string | null {
  const definition = catalogue.days.find(row => row.sourceRef === sourceId && row.day === day);
  if (!definition) return null;
  const media = definition.media.find(row => row.question === question);
  if (!media?.present) throw Error("Original MCQ question recording is missing");
  return `/api/resources/${media.objectKey}`;
}
