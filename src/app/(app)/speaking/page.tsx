import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActiveMaterials } from "@/lib/data/speaking";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MaterialPlayer } from "@/components/speaking/MaterialPlayer";
import { BlockRenderer } from "@/components/speaking/BlockRenderer";

const ORDER = ["part1", "part2", "part3", "general", "top_structures", "shadowing"] as const;

export default async function SpeakingPage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(await getLocale());
  const rows = await listActiveMaterials();

  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCategory.get(row.material.category) ?? [];
    list.push(row);
    byCategory.set(row.material.category, list);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl text-ink-900">{dict.speaking.title}</h1>
        {/* Both speaking modes live next to the materials, because they use
            them: the recording studio and the shadowing drill. Without this the
            practice studio existed but nothing on the module page led to it. */}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/speaking/practice" className="text-sm text-signal-600 hover:underline" data-speaking-practice-link>
            {dict.speakingPractice.title} →
          </Link>
          <Link href="/speaking/shadowing" className="text-sm text-signal-600 hover:underline" data-shadowing-link>
            {dict.speakingShadowing.title} →
          </Link>
        </div>
      </div>

      {rows.length === 0 && <EmptyState icon="🎙" title={dict.speaking.noMaterials} />}

      {ORDER.filter((cat) => byCategory.has(cat)).map((cat) => (
        <div key={cat}>
          <h2 className="mb-3 font-display text-lg text-ink-900">{dict.speaking.category[cat]}</h2>
          <div className="flex flex-col gap-4">
            {byCategory.get(cat)!.map(({ material, blocks }) => (
              <Card key={material.id} className="flex flex-col gap-3">
                <p className="text-sm font-medium text-ink-900">{material.title}</p>
                <MaterialPlayer
                  url={material.primaryUrl}
                  type={material.primaryType}
                  openLabel={dict.speaking.openMaterial}
                  emptyLabel={dict.speaking.noFileYet}
                />
                {blocks.length > 0 && (
                  <div className="flex flex-col gap-3 border-t border-ink-100 pt-3">
                    {blocks.map((block) => (
                      <BlockRenderer key={block.id} block={block} openLabel={dict.speaking.openMaterial} emptyLabel={dict.speaking.noFileYet} />
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
