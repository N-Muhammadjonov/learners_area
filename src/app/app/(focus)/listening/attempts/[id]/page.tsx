import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { listeningPackages, listeningDrafts } from "@/db/schema";
import { NativeListeningExam } from "@/components/listening/NativeListeningExam";
import { SectionListeningActivity } from "@/components/listening/SectionListeningActivity";
import { listeningExamState } from "@/lib/data/full-listening";
import { lexicalAssistanceAllowed } from "@/lib/listening/lexical-policy";
import { redirect } from "next/navigation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/listening";
import { ListeningExam } from "@/components/listening/ListeningExam";
import { ListeningAnalysis } from "@/components/listening/ListeningAnalysis";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { isUuid } from "@/lib/validation/ids";
import { authoredSectionNumber, getOpenableSection } from "@/lib/data/listening-general";
import { OwnerMaterialBlocks } from "@/components/resources/OwnerMaterialBlocks";

export default async function ListeningAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getAttemptDetail(id, user.id);
  if (!detail) notFound();
  const { attempt, test, questions, answers } = detail;

  /*
   * GENERAL LISTENING — one standalone section, served as ONE activity.
   *
   * The owner's product design is explicit: a General section opens DIRECTLY into the
   * familiar Listening interface — audio, questions, navigation, note-taking, highlights,
   * vocabulary and submit — with NO activity hub, NO four-part exam and no Script / MCQ /
   * Matching cards. Its multiple-choice questions are answered inside that one attempt.
   *
   * Which presentation an attempt gets is decided by the SAME classifier the catalogues
   * use, from authored facts: a section is a section whether the centre imported it as a
   * canonical package or authored it natively (in which case there is no package at all and
   * the questions come from the canonical rows).
   */
  const section = await getOpenableSection(test.id, user.id);
  const sectionNo = section?.package
    ? (section.package.sections[0]?.number ?? 1)
    : await authoredSectionNumber(test.id);

  const pkg = await listeningSchemaReady() ? await db.query.listeningPackages.findFirst({ where: eq(listeningPackages.testId, test.id) }) : null;
  if (section && attempt.status === "in_progress") {
    const draft = await db.query.listeningDrafts.findFirst({ where: eq(listeningDrafts.attemptId, id) });
    const audioUrl = test.audioUrl;
    /*
     * May this learner look a word up? The SAME policy the lexical API routes ask, with the
     * mode the source's own product implies — so the surface and the server always agree, and
     * a section (a learning activity) is not locked out of its own vocabulary the way a
     * running full exam is.
     */
    const lexicalAssistance = lexicalAssistanceAllowed("SECTION_PRACTICE", await listeningExamState(user, test.id));
    return (
      <SectionListeningActivity
        dict={dict}
        attemptId={id}
        testId={test.id}
        title={test.title}
        lexicalAssistance={lexicalAssistance}
        audioUrl={audioUrl ?? ""}
        mapDiagram={section.package?.mapDiagram}
        imageUrl={section.imageObjectKey ? `/api/resources/${section.imageObjectKey}` : null}
        duration={section.package?.audio.durationSec}
        initial={draft?.answers ?? {}}
        audioPosition={draft?.audioPosition ?? 0}
        audioStartedAt={draft?.audioStartedAt?.toISOString() ?? null}
        questions={section.questions.map((row) => ({
          id: row.id,
          number: row.order,
          section: sectionNo ?? 1,
          text: row.questionText,
          instruction: dict.listening.general.questionInstruction,
          options: row.options ?? [],
        }))}
      />
    );
  }
  /*
   * `!section` is load-bearing: a GENERAL section must never fall into this branch. It used
   * to: a finished SECTION that happens to carry a canonical package was redirected to
   * `/app/listening/tests/:id/2` — the four-part Academic result screen — while a section
   * authored natively (no package) correctly showed its own result. The presentation a
   * learner gets must not depend on HOW the centre authored the section, so the Academic
   * branch is now only for content that is not a section at all.
   */
  if (!section && pkg) {
    if (attempt.status === "completed") redirect(`/app/listening/tests/${test.id}/2`);
    const draft = await db.query.listeningDrafts.findFirst({ where: eq(listeningDrafts.attemptId, id) });
    return <NativeListeningExam dict={dict} attemptId={id} testId={test.id} title={test.title} audioUrl={test.audioUrl!}
      mapDiagram={pkg.payload.mapDiagram}
      imageUrl={pkg.imageObjectKey ? `/api/resources/${pkg.imageObjectKey}` : null}
      duration={pkg.payload.audio.durationSec} initial={draft?.answers ?? {}} audioPosition={draft?.audioPosition ?? 0}
      audioStartedAt={draft?.audioStartedAt?.toISOString() ?? null}
      questions={pkg.payload.questions.map(q => ({ id: questions.find(row => row.order === q.number)!.id, number: q.number, section: q.section, text: q.text, instruction: q.instruction, options: q.options }))} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      {section ? (
        /* A finished section shows its OWN result: the learner's answers and the correct
           answers for this section. It is never presented as an Academic test result. */
        <ListeningAnalysis dict={dict} score={attempt.score} total={attempt.totalQuestions} questions={questions} answers={answers} />
      ) : attempt.status === "in_progress" ? (
        <ListeningExam
          dict={dict}
          attemptId={attempt.id}
          testTitle={test.title}
          audioUrl={test.audioUrl}
          audioType={test.audioType}
          questions={questions.map((q) => ({
            id: q.id,
            order: q.order,
            type: q.type,
            questionText: q.questionText,
            options: q.options ?? null,
          }))}
        />
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Link
              href={`/app/listening/attempts/${attempt.id}/revision`}
              className="btn-secondary "
              data-revision-link
            >
              {dict.listening.revisionStudio} →
            </Link>
          </div>
          <ListeningAnalysis dict={dict} score={attempt.score} total={attempt.totalQuestions} questions={questions} answers={answers} />
          {test.transcript && (
            <div className="card mt-4" data-interactive-transcript>
              <h3 className="mb-2 font-display text-base text-ink-900">{dict.listening.transcript}</h3>
              <p className="mb-2 text-xs text-ink-300">{dict.listening.transcriptHint}</p>
              {/* The transcript is interactive: every word can be looked up or saved. */}
              <ClickableText
                dict={dict}
                text={test.transcript}
                sourceType="listening"
                sourceId={test.id}
                className="academic-text text-sm leading-relaxed text-ink-700"
              />
            </div>
          )}
        </>
      )}

      {/* Notes, a transcript file or a link the administrator attached to this
          test. Shown for an open attempt as well as after submitting, because
          material that only appears after the test would be useless. */}
      <div className="mt-4">
        <OwnerMaterialBlocks ownerType="listening" ownerId={test.id} ownerVisible />
      </div>
    </div>
  );
}
