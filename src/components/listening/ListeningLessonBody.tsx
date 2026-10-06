import Link from "next/link";
import type { ResolvedLessonBlock } from "@/lib/content/lessons";
import type { Dictionary } from "@/lib/i18n/en";
import { LessonQuizBlock } from "./LessonQuizBlock";

/** The projected title of a referenced canonical item, when it has one. */
function referenceTitle(block: ResolvedLessonBlock): string | null {
  const content = block.referenced?.content as { title?: unknown } | null | undefined;
  return content && typeof content.title === "string" && content.title.trim() ? content.title : null;
}

/** Is the reference a media item (the media layer owns its own learner surface)? */
function isMediaReference(block: ResolvedLessonBlock): boolean {
  return block.ref?.module === "ted";
}

/**
 * The lesson body — the MAIN content of a listening lesson, before any tab.
 *
 * Blocks are rendered in authored order as TYPED blocks: text is plain paragraphs
 * (never interpreted markup), media comes from private storage through the
 * authorizing resource route, links are links, and a canonical reference shows the
 * published content it points at (or says, honestly, why it cannot). A quiz block is
 * answered through the canonical endpoint, so the key is only revealed by the server
 * after the learner has answered.
 *
 * Nothing here is a placeholder: a block type that has no learner renderer yet is
 * reported as such rather than drawn as an empty card.
 */
export function ListeningLessonBody({ dict, blocks }: { dict: Dictionary; blocks: ResolvedLessonBlock[] }) {
  const t = dict.listening.lessons;
  if (blocks.length === 0) {
    return (
      <p className="text-sm text-ink-500" data-lesson-body-empty>
        {t.bodyEmpty}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5" data-lesson-body>
      {blocks.map((block, index) => (
        <div key={`${block.position}-${index}`} data-lesson-block={block.type}>
          {block.type === "text" && block.text && (
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-700">
              {block.text.split(/\n{2,}/).map((paragraph, position) => (
                <p key={position}>{paragraph}</p>
              ))}
            </div>
          )}

          {block.type === "audio" && block.objectKey && (
            <figure className="flex flex-col gap-2">
              <audio controls preload="none" className="w-full" src={`/api/resources/${block.objectKey}`} data-lesson-audio />
              <figcaption className="text-xs text-ink-300">{t.audioSource}</figcaption>
            </figure>
          )}

          {block.type === "video" && block.objectKey && (
            <video controls preload="none" className="w-full rounded-md bg-ink-950" src={`/api/resources/${block.objectKey}`} data-lesson-video />
          )}

          {block.type === "image" && block.objectKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/resources/${block.objectKey}`} alt="" className="w-full rounded-md" data-lesson-image />
          )}

          {block.type === "file" && block.objectKey && (
            <a className="underline text-ink-700" href={`/api/resources/${block.objectKey}`} data-lesson-file>
              {t.download}
            </a>
          )}

          {block.type === "link" && block.url && (
            <a className="underline text-ink-700" href={block.url} rel="noreferrer noopener" target="_blank" data-lesson-link>
              {block.text || block.url}
            </a>
          )}

          {block.type === "quiz" && block.quiz && (
            <LessonQuizBlock
              dict={dict}
              blockId={block.blockId}
              prompt={block.quiz.prompt}
              options={block.quiz.options}
              response={block.response ? { answer: block.response.answer, correct: block.response.correct } : null}
            />
          )}

          {block.type === "content_reference" && (
            <div className="rounded-xl border border-ink-100 p-4" data-lesson-reference>
              <p className="text-xs uppercase tracking-wide text-ink-300">{t.referencedContent}</p>
              {block.referenceProblem ? (
                <p className="mt-1 text-sm text-band-bad" data-lesson-reference-problem>
                  {block.referenceProblem}
                </p>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  <p className="text-sm font-medium text-ink-900">{referenceTitle(block) ?? (block.ref ? `${block.ref.module}:${block.ref.contentType}` : "")}</p>
                  {block.ref && <p className="text-xs text-ink-300">{block.ref.sourceRef}</p>}
                  {isMediaReference(block) && (
                    // The canonical media library, not a fabricated deep link: the
                    // reference stores a stable source ref, and the media surface is
                    // reached by the id its own library resolves.
                    <Link className="text-sm underline text-ink-700" href="/app/video-lessons" data-lesson-reference-link>
                      {t.openMediaLibrary}
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
