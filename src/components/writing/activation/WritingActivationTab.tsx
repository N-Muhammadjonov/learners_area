import type { getDictionary } from "@/lib/i18n";
import { activationVocabularyCount } from "@/lib/services/writing/activation";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { cleanCustomItem } from "@/lib/writing/activation-rules";
import { ActivationLab } from "./ActivationLab";

export async function WritingActivationTab({ dict, userId, item }: { dict: ReturnType<typeof getDictionary>; userId: string; item?: string }) {
  const vocabularyCount = await activationVocabularyCount(userId).catch(() => 0);
  return <div data-async-content="writing"><ActivationLab dict={dict} aiReady={writingAiReady()} vocabularyCount={vocabularyCount} initialItem={item ? cleanCustomItem(item) : null} /></div>;
}
