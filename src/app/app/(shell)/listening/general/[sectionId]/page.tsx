import { notFound } from "next/navigation";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BackLink } from "@/components/ui/BackLink";
import { SectionListeningActivity } from "@/components/listening/SectionListeningActivity";
import { ListeningAnalysis } from "@/components/listening/ListeningAnalysis";
import { SectionRetakeButton } from "@/components/listening/SectionRetakeButton";
import { loadSectionExercise } from "@/lib/listening/section-exercise";
import { isUuid } from "@/lib/validation/ids";

export const dynamic = "force-dynamic";

/**
 * ONE GENERAL LISTENING SECTION — the stable address of a single section.
 *
 * `/app/listening/general/<sectionId>` is what the catalogue links to and what a learner can
 * reload, go back to, go forward to, or bookmark: it always resolves to the SAME section, and
 * the attempt behind it is found (or created) by this page, never named in the URL. Opening the
 * address IS the exercise: one recording, the questions, question navigation, note-taking,
 * highlight, vocabulary and submit — no activity hub, no four-part exam framing, no Script /
 * MCQ / Matching cards.
 *
 * Once the section is finished the same address shows the learner's own result for THIS section,
 * with the section's authored evidence only, and a truthful retake action.
 */
export default async function GeneralListeningSectionPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  // Malformed ids never reach the database: the answer is a 404, not a 500.
  if (!isUuid(sectionId)) notFound();

  const dict = getDictionary(await getLocale());
  const t = dict.listening.general;
  const view = await loadSectionExercise(sectionId, user, dict);
  // Not a published standalone section (a draft, an archived item, an Academic full test, a
  // dedicated MCQ package) → 404. The gate is the catalogue's own decision, so this address
  // can never serve something the catalogue does not list.
  if (!view) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-listening-section-page={view.testId} data-listening-section-mode={view.kind}>
      <BackLink fallbackHref="/app/listening/general" label={t.title} data-listening-section-back />

      {view.kind === "exercise" ? (
        /* The ONE activity: audio, questions, navigation, notes, highlight, vocabulary, submit. */
        <SectionListeningActivity
          dict={dict}
          attemptId={view.attemptId}
          testId={view.testId}
          title={view.title}
          lexicalAssistance={view.lexicalAssistance}
          audioUrl={view.audioUrl}
          mapDiagram={view.mapDiagram}
          imageUrl={view.imageUrl}
          duration={view.duration}
          initial={view.initial}
          audioPosition={view.audioPosition}
          audioStartedAt={view.audioStartedAt}
          questions={view.questions}
        />
      ) : (
        <div className="flex flex-col gap-4" data-listening-section-result>
          <h1 className="font-display text-2xl text-ink-900">{view.title}</h1>
          {/* The learner's own result for THIS section, with this section's own evidence. */
          }
          <ListeningAnalysis
            dict={dict}
            score={view.score}
            total={view.total}
            questions={view.questions}
            answers={view.answers}
          />
          <div className="flex flex-wrap items-center gap-3">
            <SectionRetakeButton sectionId={view.testId} label={t.retake} messages={dict.auth} />
            <Link className="btn-secondary" href="/app/listening/general">
              {t.backToCatalogue}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
