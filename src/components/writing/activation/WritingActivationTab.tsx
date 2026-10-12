import type { getDictionary } from "@/lib/i18n";
import { activationOverview, activationVocabularyCount } from "@/lib/services/writing/activation";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { cleanCustomItem } from "@/lib/writing/activation-rules";
import { ActivationLab } from "./ActivationLab";

export async function WritingActivationTab({ dict, userId, item, locale }: { dict: ReturnType<typeof getDictionary>; userId: string; item?: string; locale: "uz" | "en" }) {
  const [vocabularyCount, overview] = await Promise.all([
    activationVocabularyCount(userId).catch(() => 0),
    activationOverview(userId).catch(() => ({ wordsActivated: 0, averageActivation: null, dayStreak: 0, lastSession: null })),
  ]);
  return <div data-async-content="writing"><ActivationLab dict={dict} locale={locale} aiReady={(await writingAiReady())} vocabularyCount={vocabularyCount} overview={overview} initialItem={item ? cleanCustomItem(item) : null} /></div>;
}
