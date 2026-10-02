import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { findAttemptForUser } from "@/lib/data/retention-attempts";
import { buildAttemptPayload, assertLearnerSafe } from "@/lib/retention/payload";
import { isRetentionError } from "@/lib/retention/errors";
import { RetentionResultStandalone } from "@/components/reading/RetentionResultStandalone";
import type { RetentionTerminalPayload } from "@/lib/retention/types";

export const metadata = { title: "Retention result" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * /reading/retention/results/:attemptId — reopen one of the learner's OWN
 * finished results. Ownership is part of the query (another learner's id is
 * "not available", never their data). A live attempt is not a result: it goes
 * back to the session. The terminal payload never carries source or rubric.
 */
export default async function RetentionResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const [user, locale, { attemptId }] = await Promise.all([requireActiveUser(), getLocale(), params]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.retentionMemory;

  let payload: RetentionTerminalPayload | null = null;
  let live = false;
  if (UUID.test(attemptId)) {
    try {
      const attempt = await findAttemptForUser({ attemptId, userId: user.id });
      const built = await buildAttemptPayload(attempt, new Date(), db);
      if (built.phase === "completed" || built.phase === "timed_out") {
        assertLearnerSafe(built);
        payload = built;
      } else {
        live = true;
      }
    } catch (error) {
      if (!isRetentionError(error)) throw error;
    }
  }
  if (live) redirect("/reading/retention");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" data-retention-result-page data-route-usable="retention-result">
      <BackLink fallbackHref="/reading/retention" label={dict.common.back} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{t.resultTitle}</h1>
        <Link href="/reading/retention" prefetch={false} className="btn-secondary">{t.title}</Link>
      </header>
      {payload ? (
        <RetentionResultStandalone dict={dict} payload={payload} />
      ) : (
        <p className="panel body-text" role="alert" data-retention-result-unavailable>{t.resultUnavailable}</p>
      )}
    </div>
  );
}
