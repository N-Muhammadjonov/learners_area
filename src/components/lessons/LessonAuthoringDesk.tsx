"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { startUpload } from "@/lib/uploads/client";
import { describeUploadError } from "@/lib/uploads/errors";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { LEARNING_AREAS, LEARNING_AREA_LABELS, type LearningArea } from "@/lib/content/learning-areas";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The lesson authoring desk's editor.
 *
 * It is a THIN client over the existing content-authoring API: the payload it posts is
 * exactly the `lesson` content type's authored payload, and the server decides whether
 * it is valid (`saveContentDraft` → the lesson author → `saveLessonStructure`, which
 * re-validates every block and pins a revision). There is no second write path, no
 * client-side validation pretending to be authority, and no local storage of drafts.
 *
 * Media blocks upload through the shared upload engine (intent → bytes → finalize) into
 * PRIVATE storage; the block stores the object key, never a public URL.
 *
 * Role boundary, made visible but not decided here: Save is available to every staff
 * role (the API allows staff to author drafts); Publish/Schedule is rendered only when
 * the server said this role may publish, because the service refuses it otherwise and a
 * button that always fails is a lie.
 */
type BlockType = "text" | "audio" | "video" | "image" | "file" | "link" | "quiz" | "content_reference";

type BlockDraft = {
  localId: string;
  type: BlockType;
  text: string;
  url: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number | null;
  refModule: string;
  refContentType: string;
  refSourceRef: string;
  quizQuestionType: string;
  quizPrompt: string;
  quizOptions: string;
  quizAnswer: string;
  quizExplanation: string;
  uploadState: "idle" | "uploading" | "failed" | "done";
  uploadError: string;
  progress: number;
};

const MEDIA_KINDS: Record<string, "audio" | "video" | "image" | "file"> = {
  audio: "audio",
  video: "video",
  image: "image",
  file: "file",
};

export type LessonAuthoringLesson = {
  id: string;
  title: string;
  slug: string;
  sourceRef: string;
  learningArea: string | null;
  publicationState: string;
  version: { id: string; versionNo: number; publicationState: string } | null;
};

let counter = 0;
const nextId = () => `b${++counter}-${Date.now()}`;

function emptyBlock(type: BlockType): BlockDraft {
  return {
    localId: nextId(),
    type,
    text: "",
    url: "",
    objectKey: "",
    originalName: "",
    mimeType: "",
    size: null,
    refModule: "ted",
    refContentType: "video_lesson",
    refSourceRef: "",
    quizQuestionType: "multiple_choice",
    quizPrompt: "",
    quizOptions: "",
    quizAnswer: "",
    quizExplanation: "",
    uploadState: "idle",
    uploadError: "",
    progress: 0,
  };
}

/** The API payload for one block — the authored shape the server validates. */
function toPayloadBlock(block: BlockDraft) {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "link":
      return { type: "link", text: block.text || block.url, url: block.url };
    case "audio":
    case "video":
    case "image":
    case "file":
      return {
        type: block.type,
        objectKey: block.objectKey || null,
        originalName: block.originalName || null,
        mimeType: block.mimeType || null,
        size: block.size ?? null,
      };
    case "quiz":
      return {
        type: "quiz",
        quiz: {
          questionType: block.quizQuestionType,
          prompt: block.quizPrompt,
          options: block.quizOptions.split("\n").map((line) => line.trim()).filter(Boolean),
          answer: block.quizAnswer,
          explanation: block.quizExplanation || null,
        },
      };
    case "content_reference":
      return {
        type: "content_reference",
        ref: { module: block.refModule, contentType: block.refContentType, sourceRef: block.refSourceRef },
      };
  }
}

export function LessonAuthoringDesk({
  dict,
  area,
  lessons,
  units,
  locale,
  canPublish,
}: {
  dict: Dictionary;
  area: LearningArea;
  lessons: LessonAuthoringLesson[];
  units: { id: string; label: string }[];
  locale: "en" | "uz";
  canPublish: boolean;
  isAdministrator: boolean;
}) {
  const t = dict.listening.lessons.authoring;
  const request = useScopedRequest();

  const [selected, setSelected] = useState<LessonAuthoringLesson | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [learningArea, setLearningArea] = useState<LearningArea>(area);
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [summary, setSummary] = useState("");
  const [teacherNotes, setTeacherNotes] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const [publishAt, setPublishAt] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const areaOptions = useMemo(() => LEARNING_AREAS, []);

  function reset() {
    setSelected(null);
    setTitle("");
    setSlug("");
    setSourceRef("");
    setLearningArea(area);
    setUnitId(units[0]?.id ?? "");
    setSummary("");
    setTeacherNotes("");
    setEstimatedMinutes("");
    setBlocks([]);
    setMessage(null);
    setSavedVersionId(null);
    setPublishAt("");
  }

  function openLesson(lesson: LessonAuthoringLesson) {
    setSelected(lesson);
    setTitle(lesson.title);
    setSlug(lesson.slug);
    setSourceRef(lesson.sourceRef);
    setLearningArea((lesson.learningArea as LearningArea) ?? area);
    setSummary("");
    setTeacherNotes("");
    setEstimatedMinutes("");
    setBlocks([]);
    setSavedVersionId(lesson.version?.id ?? null);
    setMessage(null);
    setPublishAt("");
  }

  function patch(localId: string, changes: Partial<BlockDraft>) {
    setBlocks((prev) => prev.map((block) => (block.localId === localId ? { ...block, ...changes } : block)));
  }

  function move(localId: string, direction: -1 | 1) {
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.localId === localId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function pickFile(localId: string, type: BlockType) {
    uploadTarget.current = localId;
    const input = fileInput.current;
    if (!input) return;
    const kind = MEDIA_KINDS[type] ?? "file";
    input.accept = kind === "image" ? "image/*" : kind === "audio" ? "audio/*" : kind === "video" ? "video/*" : ".pdf,.docx,.txt";
    input.value = "";
    input.dataset.kind = kind;
    input.click();
  }

  function onFilePicked(files: FileList | null) {
    const localId = uploadTarget.current;
    const file = files?.[0];
    uploadTarget.current = null;
    if (!localId || !file) return;
    const block = blocks.find((candidate) => candidate.localId === localId);
    if (!block) return;
    const kind = MEDIA_KINDS[block.type] ?? "file";
    patch(localId, { uploadState: "uploading", uploadError: "", progress: 0 });
    const handle = startUpload(file, {
      purpose: "material_block",
      blockKind: kind,
      onState: (state) => patch(localId, { uploadState: state === "complete" ? "done" : state === "failed" ? "failed" : "uploading" }),
      onProgress: (progress) => patch(localId, { progress }),
    });
    void handle.promise.then((outcome) => {
      if (outcome.ok) {
        patch(localId, { objectKey: outcome.objectKey, originalName: file.name, mimeType: file.type, size: file.size, uploadState: "done" });
      } else {
        patch(localId, { uploadState: "failed", uploadError: describeUploadError(outcome.error, dict.uploadErrors) });
      }
    });
  }

  async function save() {
    if (busy) return;
    if (!title.trim() || !unitId || !sourceRef.trim() || !slug.trim()) {
      setMessage({ kind: "error", text: t.saveNeedsFields });
      return;
    }
    if (blocks.some((block) => block.uploadState === "uploading")) {
      setMessage({ kind: "error", text: t.saveWhileUploading });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await request<{ ok?: boolean; versionId?: string; created?: boolean }>("/api/admin/content/drafts", {
      method: "POST",
      body: {
        module: "lesson",
        contentType: "lesson",
        sourceRef: sourceRef.trim(),
        title: title.trim(),
        payload: {
          unitId,
          slug: slug.trim(),
          learningArea,
          summary: summary.trim() ? summary : null,
          teacherNotes: teacherNotes.trim() ? teacherNotes : null,
          estimatedMinutes: estimatedMinutes ? Number.parseInt(estimatedMinutes, 10) : null,
          blocks: blocks.map(toPayloadBlock),
        },
        // Revising an existing draft revision keeps one identity; a published revision is
        // immutable, and the server refuses to rewrite it (the lesson author says why).
        versionId: savedVersionId,
      },
    });
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      const detail = Array.isArray(result.data as never) ? "" : "";
      setMessage({ kind: "error", text: `${t.saveFailed}${detail}` });
      return;
    }
    setSavedVersionId(result.data?.versionId ?? null);
    setMessage({ kind: "ok", text: result.data?.created ? t.saveCreated : t.saveRevised });
  }

  async function movePublication(to: "draft" | "scheduled" | "published" | "archived") {
    if (!savedVersionId || busy) return;
    if (to === "published" && !confirm(t.publishConfirm)) return;
    setBusy(true);
    setMessage(null);
    const result = await request<{ ok?: boolean; publicationState?: string }>(`/api/admin/content/versions/${savedVersionId}/publication`, {
      method: "POST",
      body: { to, publishAt: to === "scheduled" && publishAt ? new Date(publishAt).toISOString() : null },
    });
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      setMessage({ kind: "error", text: t.publicationRefused });
      return;
    }
    setMessage({ kind: "ok", text: `${t.publicationMoved}: ${result.data?.publicationState ?? to}` });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]" data-lesson-authoring-desk>
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-ink-900">{t.lessonsTitle}</h2>
          <Button variant="secondary" onClick={reset} data-lesson-authoring-new>
            {t.newLesson}
          </Button>
        </div>
        {lessons.length === 0 ? (
          <p className="text-sm text-ink-500" data-lesson-authoring-empty>
            {t.lessonsEmpty}
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-lesson-authoring-list>
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() => openLesson(lesson)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === lesson.id ? "border-ink-300 bg-ink-50" : "border-ink-100"}`}
                  data-lesson-authoring-item={lesson.id}
                >
                  <span className="block font-medium text-ink-900">{lesson.title}</span>
                  <span className="block text-xs text-ink-300">
                    {lesson.learningArea ?? t.unclassified} · {lesson.publicationState}
                    {lesson.version ? ` · v${lesson.version.versionNo}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="lesson-title">{t.fieldTitle}</Label>
            <Input id="lesson-title" value={title} onChange={(event) => setTitle(event.target.value)} data-lesson-authoring-title />
          </div>
          <div>
            <Label htmlFor="lesson-slug">{t.fieldSlug}</Label>
            <Input id="lesson-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="lesson-ref">{t.fieldSourceRef}</Label>
            <Input id="lesson-ref" value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} data-lesson-authoring-source-ref />
          </div>
          <div>
            <Label htmlFor="lesson-area">{t.fieldArea}</Label>
            <select
              id="lesson-area"
              className="input"
              value={learningArea}
              onChange={(event) => setLearningArea(event.target.value as LearningArea)}
              data-lesson-authoring-area
            >
              {areaOptions.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {LEARNING_AREA_LABELS[candidate][locale]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-300">{t.fieldAreaHelp}</p>
          </div>
          <div>
            <Label htmlFor="lesson-unit">{t.fieldUnit}</Label>
            <select id="lesson-unit" className="input" value={unitId} onChange={(event) => setUnitId(event.target.value)} data-lesson-authoring-unit>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="lesson-minutes">{t.fieldMinutes}</Label>
            <Input id="lesson-minutes" type="number" min={1} max={600} value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="lesson-summary">{t.fieldDescription}</Label>
            <Textarea id="lesson-summary" value={summary} onChange={(event) => setSummary(event.target.value)} data-lesson-authoring-summary />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="lesson-teacher-notes">{t.fieldTeacherNotes}</Label>
            <Textarea id="lesson-teacher-notes" value={teacherNotes} onChange={(event) => setTeacherNotes(event.target.value)} data-lesson-authoring-teacher-notes />
            <p className="mt-1 text-xs text-ink-300">{t.fieldTeacherNotesHelp}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg text-ink-900">{t.blocksTitle}</h2>
            {(["text", "video", "audio", "image", "file", "link", "quiz", "content_reference"] as BlockType[]).map((type) => (
              <Button key={type} variant="secondary" onClick={() => setBlocks((prev) => [...prev, emptyBlock(type)])} data-lesson-authoring-add={type}>
                + {t.blockTypes[type]}
              </Button>
            ))}
          </div>
          <input ref={fileInput} type="file" className="hidden" onChange={(event) => onFilePicked(event.target.files)} data-lesson-authoring-file />
          {blocks.length === 0 ? (
            <p className="text-sm text-ink-500">{t.blocksEmpty}</p>
          ) : (
            <ol className="flex flex-col gap-2" data-lesson-authoring-blocks>
              {blocks.map((block, index) => (
                <li key={block.localId} className="rounded-xl border border-ink-100 p-3" data-lesson-authoring-block={block.type}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-ink-300">
                      {index + 1}. {t.blockTypes[block.type]}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button variant="secondary" onClick={() => move(block.localId, -1)} aria-label={t.moveUp}>
                        ↑
                      </Button>
                      <Button variant="secondary" onClick={() => move(block.localId, 1)} aria-label={t.moveDown}>
                        ↓
                      </Button>
                      <Button variant="secondary" onClick={() => setBlocks((prev) => prev.filter((candidate) => candidate.localId !== block.localId))} data-lesson-authoring-remove>
                        ✕
                      </Button>
                    </span>
                  </div>

                  {(block.type === "text" || block.type === "link") && (
                    <Textarea className="mt-2" value={block.text} onChange={(event) => patch(block.localId, { text: event.target.value })} placeholder={t.blockTextPlaceholder} />
                  )}
                  {block.type === "link" && (
                    <Input className="mt-2" value={block.url} onChange={(event) => patch(block.localId, { url: event.target.value })} placeholder="https://" />
                  )}

                  {MEDIA_KINDS[block.type] && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <Button variant="secondary" onClick={() => pickFile(block.localId, block.type)} data-lesson-authoring-upload>
                        {block.objectKey ? t.replaceFile : t.chooseFile}
                      </Button>
                      {block.uploadState === "uploading" && <span data-lesson-authoring-upload-state="uploading">{t.uploading} {block.progress}%</span>}
                      {block.uploadState === "failed" && <span className="text-band-bad" data-lesson-authoring-upload-state="failed">{block.uploadError}</span>}
                      {block.objectKey && <span data-lesson-authoring-object>{block.originalName || block.objectKey}</span>}
                    </div>
                  )}

                  {block.type === "quiz" && (
                    <div className="mt-2 flex flex-col gap-2">
                      <Input value={block.quizQuestionType} onChange={(event) => patch(block.localId, { quizQuestionType: event.target.value })} placeholder="multiple_choice" />
                      <Input value={block.quizPrompt} onChange={(event) => patch(block.localId, { quizPrompt: event.target.value })} placeholder={t.quizPrompt} />
                      <Textarea value={block.quizOptions} onChange={(event) => patch(block.localId, { quizOptions: event.target.value })} placeholder={t.quizOptions} />
                      <Input value={block.quizAnswer} onChange={(event) => patch(block.localId, { quizAnswer: event.target.value })} placeholder={t.quizAnswer} />
                      <Input value={block.quizExplanation} onChange={(event) => patch(block.localId, { quizExplanation: event.target.value })} placeholder={t.quizExplanation} />
                    </div>
                  )}

                  {block.type === "content_reference" && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Input value={block.refModule} onChange={(event) => patch(block.localId, { refModule: event.target.value })} placeholder={t.refModule} />
                      <Input value={block.refContentType} onChange={(event) => patch(block.localId, { refContentType: event.target.value })} placeholder={t.refContentType} />
                      <Input value={block.refSourceRef} onChange={(event) => patch(block.localId, { refSourceRef: event.target.value })} placeholder={t.refSourceRef} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy} data-lesson-authoring-save>
            {busy ? dict.common.saving : t.save}
          </Button>
          {canPublish ? (
            <>
              <Input
                type="datetime-local"
                value={publishAt}
                onChange={(event) => setPublishAt(event.target.value)}
                className="max-w-[220px]"
                aria-label={t.scheduleAt}
                data-lesson-authoring-schedule-at
              />
              <Button variant="secondary" disabled={!savedVersionId || busy} onClick={() => void movePublication("published")} data-lesson-authoring-publish>
                {t.publish}
              </Button>
              <Button variant="secondary" disabled={!savedVersionId || busy || !publishAt} onClick={() => void movePublication("scheduled")} data-lesson-authoring-schedule>
                {t.schedule}
              </Button>
              <Button variant="secondary" disabled={!savedVersionId || busy} onClick={() => void movePublication("archived")} data-lesson-authoring-archive>
                {t.archive}
              </Button>
            </>
          ) : (
            // Not a disabled button: a teacher simply does not have this authority, and
            // the service enforces that. Saying so is clearer than a dead control.
            <span className="text-xs text-ink-300" data-lesson-authoring-no-publish>
              {t.cannotPublish}
            </span>
          )}
        </div>

        {message && (
          <p className={message.kind === "ok" ? "text-sm text-band-good" : "text-sm text-band-bad"} data-lesson-authoring-message={message.kind}>
            {message.text}
          </p>
        )}
      </section>
    </div>
  );
}
