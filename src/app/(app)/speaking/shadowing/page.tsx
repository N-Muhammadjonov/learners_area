import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActiveMaterials } from "@/lib/data/speaking";
import { resolveEmbedSource } from "@/lib/embed";
import { ShadowingStudio } from "@/components/speaking/ShadowingStudio";

export const dynamic = "force-dynamic";

/**
 * Shadowing.
 *
 * Only recordings that can actually be played back in an audio element are
 * offered: shadowing a video that the browser cannot scrub is not shadowing.
 * Nothing here is scored, and nothing recorded here is uploaded — see the panel.
 */
export default async function ShadowingPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  const materials = await listActiveMaterials();
  const tracks = materials
    .map((row) => {
      const source = resolveEmbedSource(row.material.primaryUrl ?? "", row.material.primaryType);
      return { material: row.material, source };
    })
    .filter((row) => row.source.kind === "audio")
    .map((row) => ({
      id: row.material.id,
      title: row.material.title,
      url: row.source.kind === "audio" ? row.source.src : (row.material.primaryUrl ?? ""),
      category: row.material.category,
    }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{dict.speakingShadowing.title}</h1>
          <p className="text-sm text-ink-500">{dict.speakingShadowing.hint}</p>
          {/* Stated on the page itself, not only inside the player. */}
          <p className="mt-1 text-xs text-ink-300" data-shadowing-note>
            {dict.speakingShadowing.noScore} · {dict.speakingShadowing.privacy}
          </p>
        </div>
        <Link href="/speaking" className="btn-secondary " data-shadowing-back>
          {dict.speaking.title} →
        </Link>
      </div>

      <ShadowingStudio dict={dict} tracks={tracks} />
    </div>
  );
}
