import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { getExamPaper, examEntryGrades, examGradeKey } from "@/lib/services/writing/exam";
import { resourceBlocksForPrompts } from "@/lib/data/writing";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { EXAM_MIN_WORDS, fullPaperBand } from "@/lib/writing/exam-modes";
import { countEssayWords, MIN_GRADE_WORDS } from "@/lib/writing/grade-criteria";
import { BackLink } from "@/components/ui/BackLink";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { ExamRunner } from "@/components/writing/exam/ExamRunner";
import { ExamGradeButton } from "@/components/writing/exam/ExamGradeButton";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WritingExamPaperPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  const { id } = await params;
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const dict = getDictionary(locale);
  const t = dict.writingWorkspace.exam;
  const loaded = await safeWritingQuery(() => getExamPaper(user.id, id));
  if (!loaded.ok) return <div className="mx-auto max-w-6xl"><NotMigrated dict={dict} /></div>;
  const paper = loaded.value;
  if (!paper) notFound();
  const blocks = await resourceBlocksForPrompts(paper.entries.map((e) => e.promptId));
  const materials = Object.fromEntries(paper.entries.map((e) => [e.position, <ResourceBlocks key={e.position} dict={dict} blocks={blocks.get(e.promptId) ?? []} />]));

  if (!paper.finalizedAt) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4" data-route-usable="writing-exam">
        <BackLink fallbackHref="/app/writing?tab=exam" label={t.backToExam} />
        <ExamRunner dict={dict} paper={paper} materials={materials} />
      </div>
    );
  }

  const aiReady = (await writingAiReady());
  const grades = await examEntryGrades(user.id, paper);
  const t1 = paper.entries.find((e) => e.taskType === "task1");
  const t2 = paper.entries.find((e) => e.taskType === "task2");
  const g1 = t1 ? grades.get(t1.position)?.overall ?? null : null;
  const g2 = t2 ? grades.get(t2.position)?.overall ?? null : null;
  const combined = paper.mode === "full" && g1 != null && g2 != null ? fullPaperBand(g1, g2) : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-route-usable="writing-exam" data-exam-finished={paper.finalizeReason ?? ""}>
      <BackLink fallbackHref="/app/writing?tab=exam" label={t.backToExam} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.modeLabel[paper.mode]}</p>
        <h1 className="font-display text-2xl text-ink-900">{t.finishedTitle}</h1>
        <p className="mt-1 text-base text-ink-500">{paper.finalizeReason ? t.reason[paper.finalizeReason] : ""}</p>
      </div>
      {combined != null && (
        <div className="card motion-enter flex items-center gap-4 p-5" data-exam-combined>
          <span className="font-display text-4xl text-ink-900">{combined.toFixed(1)}</span>
          <span className="text-base text-ink-500">{t.combined}</span>
        </div>
      )}
      {!aiReady && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30">{t.gradeUnavailable}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {paper.entries.map((e) => {
          const words = countEssayWords(e.content);
          const min = EXAM_MIN_WORDS[e.taskType];
          const grade = grades.get(e.position);
          return (
            <article key={e.position} className="card flex flex-col gap-3 p-5" data-exam-entry={e.taskType}>
              <h2 className="font-display text-lg text-ink-900">{t.modeLabel[e.taskType]}</h2>
              <p className="whitespace-pre-line text-sm text-ink-500">{e.prompt}</p>
              <p className={`text-sm ${words < min ? "text-band-bad" : "text-band-good"}`}>{words} {t.words} · {t.wordsOf.replace("{n}", String(min))}{words < min ? ` — ${t.belowMin}` : ""}</p>
              <div className="max-h-80 overflow-auto whitespace-pre-line rounded-md bg-paper-sunken p-3 text-base leading-relaxed text-ink-900">{e.content || "—"}</div>
              {grade?.status === "evaluated" ? (
                <Link className="btn-secondary min-h-11 self-start" href={`/app/writing/grade/${grade.requestId}`}>{t.viewGrade}{grade.overall != null ? ` · ${grade.overall.toFixed(1)}` : ""}</Link>
              ) : aiReady && paper.finalizeReason !== "abandoned" && words >= MIN_GRADE_WORDS ? (
                <ExamGradeButton taskType={e.taskType} question={e.prompt} essay={e.content} idempotencyKey={examGradeKey(paper.id, e.position)} promptId={e.promptId}
                  labels={{ grade: grade ? t.viewGrade : t.gradeWithAi, grading: t.grading, failed: t.gradeFailed }} />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
