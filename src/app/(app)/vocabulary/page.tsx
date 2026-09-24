import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listUserVocabulary, listDueVocabulary } from "@/lib/data/vocabulary";
import { Card } from "@/components/ui/Card";
import { VocabBadge } from "@/components/ui/Badge";
import { AddWordForm } from "@/components/vocabulary/AddWordForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export default async function VocabularyPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());
  const [all, due] = await Promise.all([
    listUserVocabulary(user.id),
    listDueVocabulary(user.id),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.vocabulary.title}</h1>
        <AddWordForm dict={dict} />
      </div>

      <Card className="flex items-center justify-between">
        <span className="text-sm text-ink-700">
          {dict.vocabulary.due}: <strong>{due.length}</strong>
        </span>
        <Link href="/vocabulary/review">
          <Button disabled={due.length === 0}>{dict.vocabulary.review}</Button>
        </Link>
      </Card>

      {all.length === 0 ? (
        <EmptyState icon="＋" title={dict.dashboard.noAttemptsYet} />
      ) : (
        <div className="flex flex-col divide-y divide-ink-100 rounded-md border border-ink-100 bg-paper-raised">
          {all.map(({ entry, lexeme }) => (
            <div key={entry.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink-900">{lexeme.term}</p>
                <p className="text-xs text-ink-500">{lexeme.definitionEn}</p>
              </div>
              <VocabBadge state={entry.state} label={dict.vocabulary.state[entry.state]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
