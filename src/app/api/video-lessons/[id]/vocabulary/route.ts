import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStandaloneVideoLesson } from "@/lib/data/video-lessons";
import { videoVocabulary } from "@/lib/services/lexical/video-vocabulary";
import { addVocabularyBatch } from "@/lib/services/vocabulary/engine";
import { isUuid } from "@/lib/validation/ids";
const headers = {"Cache-Control": "private, no-store"};
export async function POST(req: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({error: "unauthenticated"}, {status: 401, headers});
  const {id} = await params;
  if (!isUuid(id)) return NextResponse.json({error: "not_found"}, {status: 404, headers});
  const lesson = await getStandaloneVideoLesson(id, user.id);
  if (!lesson) return NextResponse.json({error: "not_found"}, {status: 404, headers});
  const parsed = z.object({occurrenceId: z.string().uuid()}).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error: "invalid_input"}, {status: 400, headers});
  const data = await videoVocabulary(id);
  if (!data.ready) return NextResponse.json({error: "service_unavailable", reason: "schema_missing"}, {status: 503, headers});
  const word = data.items.find(item => item.occurrenceId === parsed.data.occurrenceId);
  const body = [lesson.videoLesson.transcriptText, ...(lesson.videoLesson.transcript ?? []).map(line => line.text), lesson.videoLesson.notes].filter(Boolean).join("\n");
  if (!word || body.slice(word.startChar, word.endChar) !== word.surfaceForm) return NextResponse.json({error: "not_found"}, {status: 404, headers});
  const result = await addVocabularyBatch({userId: user.id, sourceType: "video", sourceId: id, items: [{
    term: word.term, partOfSpeech: word.partOfSpeech, definitionEn: word.definitionEn, translationUz: word.translationUz,
    exampleSentence: word.exampleSentence, sourceSnapshot: {sourceType: "video", videoLessonId: id,
      occurrenceId: word.occurrenceId, lexemeId: word.id, sourceTitle: lesson.videoLesson.title,
      surfaceForm: word.surfaceForm, sentenceText: word.exampleSentence ?? ""},
  }]});
  return NextResponse.json(result, {status: result.ok ? 200 : 400, headers});
}
