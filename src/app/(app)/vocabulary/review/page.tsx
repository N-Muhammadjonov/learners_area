import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listDueVocabulary } from "@/lib/data/vocabulary";
import { ReviewDeck } from "@/components/vocabulary/ReviewDeck";

export default async function VocabularyReviewPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());
  const due = await listDueVocabulary(user.id);

  const items = due.map(({ entry, lexeme }) => ({
    entryId: entry.id,
    term: lexeme.term,
    definitionEn: lexeme.definitionEn,
    translationUz: lexeme.translationUz,
    exampleSentence: lexeme.exampleSentence,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-center font-display text-2xl text-ink-900">{dict.vocabulary.review}</h1>
      <ReviewDeck dict={dict} initialItems={items} />
    </div>
  );
}
