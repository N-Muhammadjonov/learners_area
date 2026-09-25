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

  const dict = getDictionary(getLocale());
  const rows = await listActiveMaterials();

  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCategory.get(row.material.category) ?? [];
    list.push(row);
    byCategory.set(row.material.category, list);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="font-display text-2xl text-ink-900">{dict.speaking.title}</h1>

      {rows.length === 0 && <EmptyState icon="🎙" title={dict.speaking.noMaterials} />}

      {ORDER.filter((cat) => byCategory.has(cat)).map((cat) => (
        <div key={cat}>
          <h2 className="mb-3 font-display text-lg text-ink-900">{dict.speaking.category[cat]}</h2>
          <div className="flex flex-col gap-4">
            {byCategory.get(cat)!.map(({ material, blocks }) => (
              <Card key={material.id} className="flex flex-col gap-3">
                <p className="text-sm font-medium text-ink-900">{material.title}</p>
                <MaterialPlayer url={material.primaryUrl} type={material.primaryType} openLabel={dict.speaking.openMaterial} />
                {blocks.length > 0 && (
                  <div className="flex flex-col gap-3 border-t border-ink-100 pt-3">
                    {blocks.map((block) => (
                      <BlockRenderer key={block.id} block={block} openLabel={dict.speaking.openMaterial} />
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
