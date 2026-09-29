import { db } from "@/db/client";
import { lexicalOccurrences } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePassages } from "@/lib/data/reading";
import { Card } from "@/components/ui/Card";
import { RetentionCheck } from "@/components/reading/RetentionCheck";
import { isUuid } from "@/lib/validation/ids";

/**
 * Retention as its own reading mode.
 *
 * The drill itself has always existed, but only as the last step of a completed
 * attempt — so a student who wanted to practise recall had to sit a full test
 * first. Reading a text once and writing down what you kept is a four-minute
 * exercise; it should not cost an exam. The mode needs no attempt and no
 * scoring, and it writes no progress of its own.
 */
export default async function ReadingRetentionPage({
  searchParams,
}: {
  searchParams: Promise<{ passage?: string }>;
}) {
  const { passage: wanted } = await searchParams;
  const user = await requireActiveUser();
  if (!user) return null;

  const locale = await getLocale();
  const dict = getDictionary(locale);
  const passages = await listActivePassages();

  // Only a passage that is actually open may be chosen. A hand-typed id for an
  // archived passage falls back to the first open one instead of rendering text
  // the centre has taken down.
  const chosen = (wanted && isUuid(wanted) ? passages.find((p) => p.id === wanted) : undefined) ?? passages[0];

  const occurrences = chosen ? await db.query.lexicalOccurrences.findMany({ where: eq(lexicalOccurrences.passageId, chosen.id), columns: { id: true, startChar: true, endChar: true, surfaceForm: true } }) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.reading.retentionModeTitle}</h1>
        <Link href="/reading" className="text-sm text-signal-600 hover:underline">
          {dict.reading.practiceTitle} →
        </Link>
      </div>

      <p className="text-sm text-ink-500">{dict.reading.retentionModeHint}</p>

      {!chosen ? (
        <Card>
          <p className="text-sm text-ink-500" data-retention-empty>
            {dict.reading.retentionModeEmpty}
          </p>
        </Card>
      ) : (
        <RetentionCheck
          dict={dict}
          passageTitle={chosen.title}
          passageBody={chosen.bodyText}
          passageLevel={chosen.difficultyLevel}
          sourceId={chosen.id}
          occurrences={occurrences}
          startOpen
        />
      )}

      {passages.length > 1 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-ink-900">{dict.reading.retentionModeAnother}</h2>
          <ul className="flex flex-wrap gap-3" data-retention-choices>
            {passages
              .filter((passage) => passage.id !== chosen?.id)
              .map((passage) => (
                <li key={passage.id}>
                  <Link
                    href={`/reading/retention?passage=${passage.id}`}
                    className="text-sm text-signal-600 hover:underline"
                  >
                    {passage.title}
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
