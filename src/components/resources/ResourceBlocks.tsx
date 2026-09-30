import { ClickableText } from "@/components/vocabulary/ClickableText";
import { IconChevronDown, IconChevronRight } from "@/components/ui/icons";
import type { Dictionary } from "@/lib/i18n/en";
import type { ResourceBlockView } from "@/lib/data/resources";

/**
 * The student-facing half of the composer.
 *
 * It renders exactly the blocks that are stored, in the stored order, and nothing
 * else: no placeholder cards for material that was never attached, no empty
 * "materials" heading when there are none — a section that says "no materials"
 * on every passage would look broken rather than empty.
 *
 * Files are addressed by their private object key through `/api/resources/<key>`,
 * which re-checks who may read them on every request. The bucket is never public,
 * so no URL in this markup is shareable outside the centre.
 */
export function ResourceBlocks({
  dict,
  blocks,
  title,
}: {
  dict: Dictionary;
  blocks: ResourceBlockView[];
  title?: string;
}) {
  if (blocks.length === 0) return null;
  const t = dict.resources;

  return (
    <section className="card flex flex-col gap-3 p-5" data-resource-blocks>
      <h2 className="card-title">{title ?? t.studentsTitle}</h2>
      <ul className="flex flex-col gap-3">
        {blocks.map((block) => (
          <li key={block.id} className="flex flex-col gap-1.5" data-resource-block={block.type}>
            {block.type === "text" && (
              <ClickableText dict={dict} text={block.textContent ?? ""} sourceType="material" sourceId={block.id} className="text-sm leading-relaxed text-ink-700" />
            )}

            {block.type === "link" && block.linkUrl && (
              <a
                href={block.linkUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-secondary "
              >
                <IconChevronRight className="text-[16px]" />
                {block.originalName ?? t.openLink}
              </a>
            )}

            {block.type === "image" && block.objectKey && (
              // eslint-disable-next-line @next/next/no-img-element -- private object key, not a build-time asset
              <img
                src={`/api/resources/${block.objectKey}`}
                alt={block.originalName ?? t.blockImage}
                className="max-h-80 w-auto rounded-sm border border-ink-100"
                loading="lazy"
              />
            )}

            {block.type === "audio" && block.objectKey && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-ink-300">{block.originalName}</span>
                {/* A native player: seeking works because the delivery route
                    answers Range requests for stored audio. */}
                <audio controls preload="none" src={`/api/resources/${block.objectKey}`} className="w-full">
                  {t.blockAudio}
                </audio>
              </div>
            )}

            {block.type === "file" && block.objectKey && (
              <a
                href={`/api/resources/${block.objectKey}`}
                className="btn-secondary "
              >
                <IconChevronDown className="text-[16px]" />
                {block.originalName} — {t.download}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
