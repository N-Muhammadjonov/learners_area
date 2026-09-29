import { Suspense } from "react";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActiveMaterialsForEntry } from "@/lib/data/speaking";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MaterialPlayer } from "@/components/speaking/MaterialPlayer";
import { BlockRenderer } from "@/components/speaking/BlockRenderer";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

const ORDER = ["part1", "part2", "part3", "general", "top_structures", "shadowing"] as const;
type SpeakingEntryMaterials = Awaited<ReturnType<typeof listActiveMaterialsForEntry>>;
type SpeakingMaterialsWithBlocks = Awaited<SpeakingEntryMaterials["blocksPromise"]>;

async function SpeakingMaterialBlocks({ materialId, blocksPromise, dict }: {
  materialId: string;
  blocksPromise: SpeakingEntryMaterials["blocksPromise"];
  dict: ReturnType<typeof getDictionary>;
}) {
  const row = (await blocksPromise).find((candidate) => candidate.material.id === materialId);
  if (!row || row.blocksUnavailable || row.blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-ink-100 pt-3">
      {row.blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} openLabel={dict.speaking.openMaterial} emptyLabel={dict.speaking.noFileYet} />
      ))}
    </div>
  );
}

async function SpeakingBlocksStatus({ blocksPromise, dict }: {
  blocksPromise: SpeakingEntryMaterials["blocksPromise"];
  dict: ReturnType<typeof getDictionary>;
}) {
  const rows: SpeakingMaterialsWithBlocks = await blocksPromise;
  return rows.some((row) => row.blocksUnavailable) ? (
    <RegionFailureNotice
      region="speaking-material-blocks"
      message={dict.errors.unknown}
      retryLabel={dict.errorPage.retry}
    />
  ) : null;
}

function SpeakingBlocksSkeleton() {
  return <div aria-hidden="true" className="h-12 animate-pulse rounded-lg bg-ink-50" data-async-loading="speaking-material-blocks" />;
}

async function SpeakingMaterials({ dict }: { dict: ReturnType<typeof getDictionary> }) {
  const { rows, blocksPromise } = await listActiveMaterialsForEntry();
  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCategory.get(row.material.category) ?? [];
    list.push(row);
    byCategory.set(row.material.category, list);
  }

  return (
    <div data-speaking-materials data-async-content="speaking-materials">
      <Suspense fallback={<SpeakingBlocksSkeleton />}>
        <SpeakingBlocksStatus blocksPromise={blocksPromise} dict={dict} />
      </Suspense>
      {rows.length === 0 && <EmptyState icon="🎙" title={dict.speaking.noMaterials} />}
      {ORDER.filter((cat) => byCategory.has(cat)).map((cat) => (
        <div key={cat} className="mb-8">
          <h2 className="mb-3 font-display text-lg text-ink-900">{dict.speaking.category[cat]}</h2>
          <div className="flex flex-col gap-4">
            {byCategory.get(cat)!.map(({ material }) => (
              <Card key={material.id} className="flex flex-col gap-3">
                <p className="text-sm font-medium text-ink-900">{material.title}</p>
                <MaterialPlayer
                  url={material.primaryUrl}
                  type={material.primaryType}
                  openLabel={dict.speaking.openMaterial}
                  emptyLabel={dict.speaking.noFileYet}
                />
                <Suspense fallback={<SpeakingBlocksSkeleton />}>
                  <SpeakingMaterialBlocks materialId={material.id} blocksPromise={blocksPromise} dict={dict} />
                </Suspense>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SpeakingMaterialsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4" data-speaking-materials-skeleton data-async-loading="speaking-materials">
      {[0, 1, 2].map((row) => <div key={row} className="h-36 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function SpeakingPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8" data-route-usable="speaking">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl text-ink-900">{dict.speaking.title}</h1>
        {/* Both speaking modes live next to the materials, because they use them. */}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/speaking/practice" className="text-sm text-signal-600 hover:underline" data-speaking-practice-link>
            {dict.speakingPractice.title} →
          </Link>
          <Link href="/speaking/shadowing" className="text-sm text-signal-600 hover:underline" data-shadowing-link>
            {dict.speakingShadowing.title} →
          </Link>
        </div>
      </div>
      <Suspense fallback={<SpeakingMaterialsSkeleton />}>
        <SpeakingMaterials dict={dict} />
      </Suspense>
    </div>
  );
}
