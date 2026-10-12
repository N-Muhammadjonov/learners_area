import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import {
  getAttemptDetail,
  getListeningMistakeMap,
  getTestKeywordTable,
  listMcqQuestions,
  listMcqSessions,
  listSubmittedAttempts,
} from "@/lib/data/listening";
import { speedTrainingStatus, supportsRateControl } from "@/lib/services/listening/speed-training";
import { wordsFromSource } from "@/lib/services/vocabulary/engine";
import type { McqStage } from "@/lib/services/listening/mcq-mastery";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { McqMastery } from "@/components/listening/McqMastery";
import { SpeedTrainer } from "@/components/listening/SpeedTrainer";

/**
 * The Revision studio — what happens *after* the exam.
 *
 * Exam → Revision → keywords and paraphrases → speed training → vocabulary,
 * with MCQ Mastery as the staged drill for the multiple-choice questions. Every
 * number on this page comes from the student's own graded answers: there is no
 * predicted band, no invented accuracy and no "resume" that cannot be resumed.
 */
export default async function ListeningRevisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  const detail = await getAttemptDetail(id, user.id);
  if (!detail) notFound();
  const { attempt, test, questions } = detail;
  if (attempt.status === "in_progress") notFound();

  const [mistakeMap, keywords, mcqQuestions, mcqSessionRows, attempts, vocabulary] = await Promise.all([
    getListeningMistakeMap(user.id),
    getTestKeywordTable(test.id),
    listMcqQuestions(test.id),
    listMcqSessions(user.id, test.id),
    listSubmittedAttempts(user.id, test.id),
    wordsFromSource(user.id, "listening", 50, test.id),
  ]);

  const speed = speedTrainingStatus(attempts);
  const mcq = mcqQuestions.map((q) => ({
    id: q.id,
    order: q.order,
    questionText: q.questionText,
    stage: (mcqSessionRows.get(q.id)?.stage ?? "listen") as McqStage,
  }));

  const typeLabel: Record<string, string> = dict.listening.type;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{dict.listening.revisionStudio}</h1>
          <p className="text-sm text-ink-500">{test.title}</p>
        </div>
        <Link
          href={`/app/listening/attempts/${attempt.id}`}
          className="btn-secondary "
          data-back-to-analysis
        >
          {dict.listening.backToAnalysis}
        </Link>
      </div>

      <p className="text-sm text-ink-500">{dict.listening.revisionSubtitle}</p>

      {/* ---------------------------------------------------------------- */}
      {/* Mistake map — counted from this student's own graded answers only. */}
      {/* ---------------------------------------------------------------- */}
      <Card data-mistake-map>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg text-ink-900">{dict.listening.mistakeMap}</h2>
          <span className="text-xs text-ink-300">{dict.listening.mistakeMapHint}</span>
        </div>

        {mistakeMap.byType.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500" data-mistake-empty>
            {dict.listening.mistakeMapEmpty}
          </p>
        ) : (
          <>
            {mistakeMap.weakest && (
              <p className="mt-2 text-sm text-ink-700" data-weakest-type={mistakeMap.weakest.type}>
                {dict.listening.weakestType}: {typeLabel[mistakeMap.weakest.type]} ·{" "}
                {Math.round(mistakeMap.weakest.accuracy * 100)}%
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {mistakeMap.byType.map((row) => (
                <div key={row.type} data-type-accuracy={row.type}>
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span>{typeLabel[row.type]}</span>
                    <span>
                      {row.correct}/{row.total} · {dict.listening.attemptsCounted}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-sm bg-paper-sunken">
                    <div
                      className="h-2 rounded-sm bg-signal-600"
                      style={{ width: `${Math.round(row.accuracy * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {mistakeMap.recent.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">{dict.listening.missedQuestions}</h3>
            <ul className="flex flex-col divide-y divide-ink-100">
              {mistakeMap.recent.map((m) => (
                <li key={m.questionId} className="py-2" data-mistake={m.questionId}>
                  <p className="text-sm text-ink-900">{m.questionText}</p>
                  <p className="text-xs text-ink-500">
                    {dict.listening.yourAnswer}: <span className="text-ink-900">{m.userAnswer || "—"}</span> ·{" "}
                    {dict.listening.correctAnswer}: <span className="text-ink-900">{m.correctAnswer}</span>
                  </p>
                  {/* A miss is the best moment to learn the word that caused it. */}
                  <ClickableText
                    dict={dict}
                    text={m.explanation}
                    sourceType="listening"
                    sourceId={test.id}
                    className="text-xs leading-relaxed text-ink-300"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* Keywords and paraphrases — authored, never inferred from text. */}
      {/* ------------------------------------------------------------- */}
      <Card data-keyword-table>
        <h2 className="font-display text-lg text-ink-900">{dict.listening.keywordsTitle}</h2>
        <p className="mt-1 text-xs text-ink-300">{dict.listening.keywordsHint}</p>

        {keywords.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500" data-keywords-empty>
            {dict.listening.keywordsEmpty}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {keywords.map((entry) => (
              <div key={entry.id} className="rounded-sm bg-paper-sunken p-3" data-keyword-row={entry.id}>
                <p className="text-sm text-ink-900">
                  {entry.order}. {entry.questionText}
                </p>
                {entry.keywords.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-xs text-ink-300">{dict.listening.keywordsLabel}:</span>
                    {entry.keywords.map((word) => (
                      <span key={word} className="badge bg-paper text-ink-700">
                        {word}
                      </span>
                    ))}
                  </div>
                )}
                {entry.paraphrases.length > 0 && (
                  /* A phone is narrower than a two-column table: scroll, never clip. */
                  <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[280px] text-left text-xs">
                    <thead>
                      <tr className="text-ink-300">
                        <th className="font-medium">{dict.listening.heardLabel}</th>
                        <th className="font-medium">{dict.listening.askedLabel}</th>
                      </tr>
                    </thead>
                    <tbody className="text-ink-700">
                      {entry.paraphrases.map((pair) => (
                        <tr key={`${pair.heard}-${pair.asked}`}>
                          <td className="py-0.5 pr-2">{pair.heard}</td>
                          <td className="py-0.5">{pair.asked}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <SpeedTrainer
        sourceId={attempt.id}
        dict={dict}
        audioUrl={test.audioUrl}
        rateControlSupported={supportsRateControl(test.audioType)}
        status={speed}
        transcript={test.transcript}
      />

      <McqMastery dict={dict} questions={mcq} />

      {/* --------------------------------------------------- */}
      {/* Vocabulary — the words this student saved from here. */}
      {/* --------------------------------------------------- */}
      <Card data-test-vocabulary>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg text-ink-900">{dict.listening.wordsFromTest}</h2>
          <Link
            href="/app/vocabulary?panel=my-words"
            className="btn-secondary "
            data-vocabulary-link
          >
            {dict.nav.vocabulary} →
          </Link>
        </div>
        <p className="mt-1 text-xs text-ink-300">{dict.listening.wordsFromTestHint}</p>

        {vocabulary.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500" data-vocabulary-empty>
            {dict.listening.mistakeMapEmpty}
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {vocabulary.map((word) => (
              <li key={word.id} className="flex items-center gap-1" data-test-word={word.term}>
                <span className="badge bg-paper-sunken text-ink-700">{word.term}</span>
                {word.translationUz && <span className="text-xs text-ink-300">{word.translationUz}</span>}
              </li>
            ))}
          </ul>
        )}

      </Card>

      {questions.length === 0 && <EmptyState title={dict.listening.mcqEmpty} />}
    </div>
  );
}
