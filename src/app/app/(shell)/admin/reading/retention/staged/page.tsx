import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { RETENTION_LEVELS, isRetentionLevel, type RetentionLevel } from "@/lib/retention/levels";
import { readStagedRetentionReview } from "@/lib/retention/staged-review";

export const metadata = { title: "Retention V2 · Owner QA" };

/**
 * Owner/Admin-only staging preview, deliberately independent of the production
 * retention_texts bank. No learner routes, mutations, grading/attempt creation,
 * rubric serialization, or publish action.
 */
export default async function RetentionStagedReviewPage({ searchParams }: {
  searchParams: Promise<{ level?: string | string[] }>;
}) {
  const [administrator, locale, params] = await Promise.all([
    requireAdministrator(), getLocale(), searchParams,
  ]);
  if (!administrator) redirect("/app");

  const selected = Array.isArray(params.level) ? params.level[0] : params.level;
  const level: RetentionLevel = isRetentionLevel(selected) ? selected : "A2";
  const report = readStagedRetentionReview(level);
  const uz = locale === "uz";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5" data-route-usable="retention-staged-review" data-retention-qa-hold>
      <header className="flex flex-col gap-2">
        <Link href="/app/admin/reading/retention" className="link-inline w-fit">
          ← {uz ? "Retention boshqaruviga qaytish" : "Back to Retention management"}
        </Link>
        <h1 className="page-title">{uz ? "Retention FINAL V2 — Owner tekshiruvi" : "Retention FINAL V2 — Owner review"}</h1>
        <p className="body-text">
          {uz
            ? "Manbadan o‘qilgan 75 ta matnning faqat ko‘rish sahifasi. Bu materiallar hali talabalarga ochilmagan."
            : "Read-only preview of the 75 authored texts. This content is not available to learners yet."}
        </p>
      </header>

      <section className="panel flex flex-col gap-2 border-warning-300" role="status" data-retention-staged-warning>
        <h2 className="card-title">{uz ? "NASHR TO‘XTATILGAN — QA HOLD" : "PUBLICATION BLOCKED — QA HOLD"}</h2>
        <p className="body-text">
          {uz
            ? "Baholash qoidalaridagi nomuvofiqliklar tekshirilmaguncha ushbu matnlarni nashr qilmang. Bu sahifa hech narsani database'ga yozmaydi."
            : "Do not publish these texts until scoring discrepancies are reviewed. This page performs no database writes."}
        </p>
        <p className="meta-text" data-retention-staged-counts>
          {level}: {report.items.length} {uz ? "ta matn" : "texts"} ·
          {" "}{report.heldTextCount} {uz ? "ta QA-hold matn" : "held texts"} ·
          {" "}{report.mismatchCount} {uz ? "ta baholash nomuvofiqligi" : "scoring mismatches"}
        </p>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label={uz ? "Daraja" : "Level"} data-retention-staged-levels>
        {RETENTION_LEVELS.map(nextLevel => (
          <Link
            key={nextLevel}
            href={`/app/admin/reading/retention/staged?level=${nextLevel}`}
            aria-current={level === nextLevel ? "page" : undefined}
            className={`btn-secondary ${level === nextLevel ? "border-signal-400" : ""}`}
          >{nextLevel}</Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3" aria-label={uz ? "Matnlarni tekshirish" : "Review texts"} data-retention-staged-items>
        {report.items.map(item => (
          <details key={item.sourceId} className="panel" data-retention-staged-item={item.sourceId}>
            <summary className="cursor-pointer text-base font-semibold">
              {item.sourceId} · {item.wordCount} {uz ? "so‘z" : "words"}
              {" · "}
              {item.held ? (uz ? "Baholash tekshiruvi kerak" : "Scoring needs review") : (uz ? "Hozirgi testda nomuvofiqlik yo‘q" : "No current scoring discrepancy")}
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <p className="body-text whitespace-pre-wrap" data-retention-staged-body>{item.bodyText}</p>
              <p className="meta-text" data-retention-staged-score>
                {uz ? "Asl matn balli" : "Source-text score"}: {item.sourceScore}/100 ·
                {" "}{uz ? "Muallif claimlari balli" : "Canonical-claim score"}: {item.canonicalScore}/100
              </p>
              {item.missingGroups.length > 0 && (
                <p className="meta-text" data-retention-staged-missing>
                  {uz ? "Baholashda topilmagan guruhlar" : "Missing scoring groups"}:
                  {" "}{item.missingGroups.map(c => `${c.claimId} (${c.missingGroupIds.join(", ")})`).join("; ")}
                </p>
              )}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
