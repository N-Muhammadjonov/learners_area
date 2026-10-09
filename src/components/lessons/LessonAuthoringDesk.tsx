"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { startUpload } from "@/lib/uploads/client";
import { describeUploadError } from "@/lib/uploads/errors";
import { requestJson, failureMessage, type ApiIssue } from "@/lib/http/client-request";
import { LESSON_BLOCK_TYPES } from "@/lib/content/blocks";
import { LEARNING_AREAS, LEARNING_AREA_LABELS, type LearningArea } from "@/lib/content/learning-areas";
import { QUESTION_TYPES } from "@/lib/content/question-types";
import type { LessonEditModel } from "@/lib/content/lesson-edit";
import { blockPayload, type EditableLessonBlock } from "@/lib/content/lesson-edit-shape";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * THE LESSON AUTHORING DESK.
 *
 * It is the human control panel for the centre's lessons: a list on the left, the lesson
 * itself on the right, and NOTHING else invented. What makes it an editor rather than a
 * form is what it does when you select a lesson — it loads that lesson's EDITABLE
 * REVISION (every field, every block, in order) and hydrates the form from it. Changing
 * one field therefore saves one field: an author never has to remember what was there,
 * and an incomplete blank form can never be written over real content.
 *
 * Three states are shown exactly, because conflating them is how content gets lost:
 *
 *   • a lesson students are reading is LIVE — it is never edited in place, and the desk
 *     offers "Create revision" instead of pretending Save would apply immediately;
 *   • an editable DRAFT is a proposal that lives in the revision store;
 *   • publishing is an administrator or owner action, and the control is absent (not
 *     merely failing) for a role that does not hold it.
 *
 * Everything is done through the existing Content OS services — this component owns no
 * storage rule, no validation rule and no publication rule of its own.
 */

type BlockDraft = EditableLessonBlock & {
  /** Local identity for React keys and reordering. Never sent to the server. */
  localId: string;
  uploadState: "idle" | "uploading" | "failed";
  uploadError: string;
  progress: number;
};

type Form = {
  title: string;
  slug: string;
  sourceRef: string;
  learningArea: LearningArea;
  unitId: string;
  summary: string;
  teacherNotes: string;
  estimatedMinutes: string;
  blocks: BlockDraft[];
};

export type DeskLesson = {
  id: string;
  title: string;
  slug: string;
  sourceRef: string;
  learningArea: string | null;
  publicationState: string;
  draft: { id: string; versionNo: number; publicationState: string } | null;
  published: { id: string; versionNo: number; publicationState: string } | null;
};

let counter = 0;
const localId = () => `blk-${++counter}-${Date.now()}`;

function emptyBlock(type: string): BlockDraft {
  const base = { localId: localId(), uploadState: "idle" as const, uploadError: "", progress: 0 };
  switch (type) {
    case "text":
      return { ...base, type, text: "", url: null, objectKey: null, originalName: null, mimeType: null, size: null, ref: null, quiz: null };
    case "link":
      return { ...base, type, text: "", url: "", objectKey: null, originalName: null, mimeType: null, size: null, ref: null, quiz: null };
    case "quiz":
      return {
        ...base,
        type,
        text: null,
        url: null,
        objectKey: null,
        originalName: null,
        mimeType: null,
        size: null,
        ref: null,
        quiz: { questionType: "mcq_single", prompt: "", options: null, answer: "", explanation: null },
      };
    case "content_reference":
      return {
        ...base,
        type,
        text: null,
        url: null,
        objectKey: null,
        originalName: null,
        mimeType: null,
        size: null,
        ref: { module: "ted", contentType: "video_lesson", sourceRef: "", versionId: null },
        quiz: null,
      };
    default:
      return { ...base, type, text: null, url: null, objectKey: null, originalName: null, mimeType: null, size: null, ref: null, quiz: null };
  }
}

function blockFromModel(block: EditableLessonBlock): BlockDraft {
  return { ...block, localId: localId(), uploadState: "idle", uploadError: "", progress: 0 };
}

function formFromModel(model: LessonEditModel, fallbackUnitId: string): Form {
  return {
    title: model.title,
    slug: model.slug,
    sourceRef: model.sourceRef,
    learningArea: model.learningArea ?? "general",
    unitId: model.unitId || fallbackUnitId,
    summary: model.summary ?? "",
    teacherNotes: model.teacherNotes ?? "",
    estimatedMinutes: model.estimatedMinutes === null ? "" : String(model.estimatedMinutes),
    blocks: model.blocks.map(blockFromModel),
  };
}

function blankForm(area: LearningArea, unitId: string): Form {
  return {
    title: "",
    slug: "",
    sourceRef: "",
    learningArea: area,
    unitId,
    summary: "",
    teacherNotes: "",
    estimatedMinutes: "",
    blocks: [],
  };
}

const MEDIA_KINDS: Record<string, "audio" | "video" | "image" | "file"> = {
  audio: "audio",
  video: "video",
  image: "image",
  file: "file",
};

const ACCEPT: Record<string, string> = {
  image: "image/*",
  audio: "audio/*",
  video: "video/*",
  file: ".pdf,.docx,.txt",
};

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
  lessons: DeskLesson[];
  units: { id: string; label: string }[];
  locale: "en" | "uz";
  canPublish: boolean;
}) {
  const t = dict.listening.lessons.authoring;
  const issueText = dict.listening.lessons.authoringIssues;
  const router = useRouter();

  const [selection, setSelection] = useState<"none" | "new" | string>("none");
  const [model, setModel] = useState<LessonEditModel | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  // The desk receives one bounded page of units. Once a centre authors more units than
  // fit that page, the rest are only reachable by asking the server — otherwise unit
  // #501+ would be silently unselectable. Typing here searches the whole curriculum.
  const [unitQuery, setUnitQuery] = useState("");
  const [unitResults, setUnitResults] = useState<{ id: string; label: string }[] | null>(null);
  const [unitSearching, setUnitSearching] = useState(false);
  const unitOptions = unitResults ?? units;

  useEffect(() => {
    const term = unitQuery.trim();
    if (!term) { setUnitResults(null); setUnitSearching(false); return; }
    let cancelled = false;
    setUnitSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lessons/units?q=${encodeURIComponent(term)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { options?: { id: string; label: string }[] };
        if (!cancelled) setUnitResults(data.options ?? []);
      } finally {
        if (!cancelled) setUnitSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [unitQuery]);
  const areaLabel = useCallback((value: LearningArea) => LEARNING_AREA_LABELS[value][locale], [locale]);

  /** Render an issue: the centre's own wording for a known code, the server's sentence otherwise. */
  const describeIssue = useCallback(
    (issue: ApiIssue) => {
      const known = (issueText as Record<string, string>)[issue.code];
      return known ?? issue.message;
    },
    [issueText],
  );

  const loadLesson = useCallback(
    async (lessonId: string, { keepNotice = false }: { keepNotice?: boolean } = {}) => {
      setLoading(true);
      setIssues([]);
      if (!keepNotice) setNotice(null);
      const result = await requestJson<{ lesson: LessonEditModel }>(`/api/admin/content/lessons/${lessonId}/edit`, {
        method: "GET",
      });
      setLoading(false);
      if (!result.ok) {
        setIssues(result.issues?.length ? result.issues : [{ code: "load_failed", message: t.loadFailed }]);
        return null;
      }
      setModel(result.data.lesson);
      setForm(formFromModel(result.data.lesson, unitOptions[0]?.id ?? ""));
      setDirty(false);
      return result.data.lesson;
    },
    [t.loadFailed, unitOptions],
  );

  const openLesson = useCallback(
    async (lessonId: string) => {
      if (selection === lessonId) return;
      if (dirty && !window.confirm(t.discardConfirm)) return;
      setSelection(lessonId);
      await loadLesson(lessonId);
    },
    [dirty, loadLesson, selection, t.discardConfirm],
  );

  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t.discardConfirm)) return;
    setSelection("new");
    setModel(null);
    setForm(blankForm(area, unitOptions[0]?.id ?? ""));
    setIssues([]);
    setNotice(null);
    setDirty(false);
  }, [area, dirty, t.discardConfirm, unitOptions]);

  const patchForm = useCallback((changes: Partial<Form>) => {
    setForm((previous) => (previous ? { ...previous, ...changes } : previous));
    setDirty(true);
  }, []);

  const patchBlock = useCallback((id: string, changes: Partial<BlockDraft>) => {
    setForm((previous) =>
      previous ? { ...previous, blocks: previous.blocks.map((block) => (block.localId === id ? { ...block, ...changes } : block)) } : previous,
    );
    setDirty(true);
  }, []);

  const moveBlock = useCallback((id: string, direction: -1 | 1) => {
    setForm((previous) => {
      if (!previous) return previous;
      const index = previous.blocks.findIndex((block) => block.localId === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.blocks.length) return previous;
      const blocks = [...previous.blocks];
      [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
      return { ...previous, blocks };
    });
    setDirty(true);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setForm((previous) => (previous ? { ...previous, blocks: previous.blocks.filter((block) => block.localId !== id) } : previous));
    setDirty(true);
  }, []);

  const addBlock = useCallback((type: string) => {
    setForm((previous) => (previous ? { ...previous, blocks: [...previous.blocks, emptyBlock(type)] } : previous));
    setDirty(true);
  }, []);

  const pickFile = useCallback((block: BlockDraft) => {
    uploadTarget.current = block.localId;
    const input = fileInput.current;
    if (!input) return;
    input.accept = ACCEPT[MEDIA_KINDS[block.type] ?? "file"] ?? "";
    input.value = "";
    input.click();
  }, []);

  /**
   * Upload a media file for one block.
   *
   * The block's CURRENT object key is left in place until the new upload has succeeded:
   * a failed replacement therefore cannot strip a lesson of the media it already has.
   */
  const onFilePicked = useCallback(
    (files: FileList | null) => {
      const target = uploadTarget.current;
      const file = files?.[0];
      uploadTarget.current = null;
      if (!target || !file || !form) return;
      const block = form.blocks.find((candidate) => candidate.localId === target);
      if (!block) return;
      const kind = MEDIA_KINDS[block.type] ?? "file";
      patchBlock(target, { uploadState: "uploading", uploadError: "", progress: 0 });
      const handle = startUpload(file, {
        purpose: "material_block",
        blockKind: kind,
        onState: (state) => {
          if (state === "complete") return;
          patchBlock(target, { uploadState: state === "failed" ? "failed" : "uploading" });
        },
        onProgress: (progress) => patchBlock(target, { progress }),
      });
      void handle.promise.then((outcome) => {
        if (outcome.ok) {
          patchBlock(target, {
            objectKey: outcome.objectKey,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
            uploadState: "idle",
            uploadError: "",
          });
          setNotice(t.mediaReplaced);
        } else {
          patchBlock(target, { uploadState: "failed", uploadError: describeUploadError(outcome.error, dict.uploadErrors) });
          setNotice(t.mediaFailed);
        }
      });
    },
    [dict.uploadErrors, form, patchBlock, t.mediaFailed, t.mediaReplaced],
  );

  /** Load the revision that was already in progress when somebody else left it open. */
  const existing = typeof selection === "string" && selection !== "new" && selection !== "none" ? selection : null;
  const lessonRow = useMemo(() => lessons.find((lesson) => lesson.id === existing) ?? null, [existing, lessons]);
  const editableDraft = model?.draft ?? null;
  const liveWithoutDraft = Boolean(model && model.live && !model.draft);

  const startRevision = useCallback(async () => {
    if (!existing || busy) return;
    setBusy(true);
    setIssues([]);
    setNotice(null);
    const result = await requestJson<{ created: boolean; lesson: LessonEditModel }>(
      `/api/admin/content/lessons/${existing}/revision`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues?.length ? result.issues : [{ code: "revision_failed", message: failureMessage(result, dict.auth, { publish_forbidden: t.publicationRefused }) }]);
      return;
    }
    setModel(result.data.lesson);
    setForm(formFromModel(result.data.lesson, unitOptions[0]?.id ?? ""));
    setDirty(false);
    setNotice(result.data.created ? t.revisionCreated : t.revisionExistsOpened);
    router.refresh();
  }, [busy, dict.auth, existing, router, t.publicationRefused, t.revisionCreated, t.revisionExistsOpened, unitOptions]);

  const save = useCallback(async () => {
    if (!form || busy) return;
    const missing =
      !form.title.trim() || !form.slug.trim() || !form.sourceRef.trim() || !form.unitId || !form.learningArea;
    if (missing) {
      setIssues([{ code: "missing_fields", message: t.saveNeedsFields }]);
      return;
    }
    if (form.blocks.some((block) => block.uploadState === "uploading")) {
      setIssues([{ code: "upload_in_progress", message: t.saveWhileUploading }]);
      return;
    }
    if (liveWithoutDraft) {
      setIssues([{ code: "live_lesson", message: t.liveLessonLocked }]);
      return;
    }
    setBusy(true);
    setIssues([]);
    setNotice(null);
    const result = await requestJson<{ versionId: string; versionNo: number; created: boolean; targetId: string | null }>("/api/admin/content/drafts", {
      method: "POST",
      body: {
        module: "lesson",
        contentType: "lesson",
        sourceRef: form.sourceRef.trim(),
        title: form.title.trim(),
        payload: {
          unitId: form.unitId,
          slug: form.slug.trim(),
          learningArea: form.learningArea,
          summary: form.summary.trim() ? form.summary : null,
          teacherNotes: form.teacherNotes.trim() ? form.teacherNotes : null,
          estimatedMinutes: Number.isFinite(Number.parseInt(form.estimatedMinutes, 10)) ? Number.parseInt(form.estimatedMinutes, 10) : null,
          blocks: form.blocks.map(blockPayload),
        },
        // An editable draft is revised in place; a live lesson is never sent here at all
        // (the desk asks for a revision first), so this is always a draft identity.
        versionId: editableDraft?.versionId ?? null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues?.length ? result.issues : [{ code: "save_failed", message: failureMessage(result, dict.auth) }]);
      return;
    }
    setNotice(t.savedDraft);
    setDirty(false);
    // Re-read the lesson so the editor shows the revision the save actually wrote.
    // A FIRST save has no lesson selected yet: the response names the row it created.
    const savedId = selection === "new" ? result.data.targetId : (selection as string);
    if (savedId) {
      setSelection(savedId);
      await loadLesson(savedId, { keepNotice: true });
    }
    router.refresh();
  }, [busy, dict.auth, editableDraft, form, liveWithoutDraft, loadLesson, router, selection, t.liveLessonLocked, t.saveNeedsFields, t.saveWhileUploading, t.savedDraft]);

  const movePublication = useCallback(
    async (to: "draft" | "scheduled" | "published" | "archived") => {
      const versionId = editableDraft?.versionId ?? null;
      if (!versionId || busy) return;
      if (to === "published" && !window.confirm(t.publishConfirm)) return;
      setBusy(true);
      setIssues([]);
      setNotice(null);
      const result = await requestJson<{ publicationState: string }>(`/api/admin/content/versions/${versionId}/publication`, {
        method: "POST",
        body: { to, publishAt: to === "scheduled" && publishAt ? new Date(publishAt).toISOString() : null },
      });
      setBusy(false);
      if (!result.ok) {
        setIssues(result.issues?.length ? result.issues : [{ code: "publication_refused", message: failureMessage(result, dict.auth, { publish_forbidden: t.publicationRefused }) }]);
        return;
      }
      setNotice(`${t.publicationMoved}: ${result.data.publicationState}`);
      await loadLesson(selection as string, { keepNotice: true });
      router.refresh();
    },
    [busy, dict.auth, editableDraft, loadLesson, publishAt, router, selection, t.publicationMoved, t.publicationRefused, t.publishConfirm],
  );

  // The selected lesson is editor state; a lesson that disappears from the list (deleted
  // by somebody else, filtered away) must not leave a stale editor open.
  useEffect(() => {
    if (existing && !lessonRow && !loading) setSelection("none");
  }, [existing, lessonRow, loading]);

  const status = (() => {
    if (selection === "none") return null;
    if (selection === "new") return <span className="text-xs text-ink-300">{t.newLessonHeading}</span>;
    const published = model?.published;
    const draft = model?.draft;
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-ink-500" data-lesson-authoring-status>
        {published ? (
          <span className="rounded-full bg-ink-50 px-2 py-0.5" data-lesson-authoring-published={published.versionNo}>
            {t.publishedLabel} v{published.versionNo}
          </span>
        ) : (
          <span className="rounded-full bg-ink-50 px-2 py-0.5">{t.noRevisionLabel}</span>
        )}
        {draft ? (
          <span className="rounded-full bg-ink-50 px-2 py-0.5" data-lesson-authoring-draft={draft.versionNo}>
            {t.editingLabel} v{draft.versionNo}
          </span>
        ) : null}
        {model?.scheduled ? (
          <span className="rounded-full bg-ink-50 px-2 py-0.5" data-lesson-authoring-scheduled={model.scheduled.versionNo}>
            {t.scheduledLabel} v{model.scheduled.versionNo}
          </span>
        ) : null}
        {dirty ? <span className="text-ink-500" data-lesson-authoring-dirty>{t.unsavedChanges}</span> : <span className="text-ink-300">{t.allChangesSaved}</span>}
      </span>
    );
  })();

  return (
    <div
      className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]"
      data-lesson-authoring-desk
      // The role boundary as server-rendered fact: the client never re-decides it.
      data-lesson-authoring-can-publish={canPublish ? "true" : "false"}
    >
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg text-ink-900">{t.lessonsTitle}</h2>
          <Button variant="secondary" onClick={startNew} data-lesson-authoring-new>
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
                  onClick={() => void openLesson(lesson.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selection === lesson.id ? "border-ink-300 bg-ink-50" : "border-ink-100"}`}
                  data-lesson-authoring-item={lesson.id}
                  // The revision state as data too, so "Published v3 / Editing Draft v4" is
                  // machine-checkable and not just a sentence a human has to trust.
                  data-lesson-authoring-item-published={lesson.published ? lesson.published.versionNo : undefined}
                  data-lesson-authoring-item-draft={lesson.draft ? lesson.draft.versionNo : undefined}
                >
                  <span className="block font-medium text-ink-900">{lesson.title}</span>
                  <span className="block text-xs text-ink-300">
                    {lesson.learningArea ? areaLabel(lesson.learningArea as LearningArea) : t.unclassified}
                    {lesson.published ? ` · ${t.publishedLabel} v${lesson.published.versionNo}` : ""}
                    {lesson.draft ? ` · ${t.editingLabel} v${lesson.draft.versionNo}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex flex-col gap-4">
        {selection === "none" || !form ? (
          <div className="rounded-xl border border-ink-100 p-6 text-sm text-ink-500" data-lesson-authoring-idle>
            <p>{loading ? t.loadingLesson : t.selectLesson}</p>
            {/*
              The role boundary is stated before a lesson is opened, not only inside the
              editor: a teacher should know what their save does (and what it cannot do)
              while they are still choosing what to work on.
            */}
            {!canPublish ? (
              <p className="mt-2 text-xs text-ink-300" data-lesson-authoring-no-publish>
                {t.cannotPublish}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg text-ink-900">
                {selection === "new" ? t.newLessonHeading : t.editingLessonHeading}
              </h2>
              {status}
            </div>

            {loading ? <p className="text-sm text-ink-500">{t.loadingLesson}</p> : null}

            {liveWithoutDraft ? (
              <div className="rounded-xl border border-ink-100 p-3" data-lesson-authoring-needs-revision>
                <p className="text-sm text-ink-500">{t.revisionNoneBody}</p>
                <Button className="mt-2" onClick={() => void startRevision()} disabled={busy} data-lesson-authoring-start-revision>
                  {busy ? t.creatingRevision : t.createRevision}
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="lesson-title">{t.fieldTitle}</Label>
                <Input id="lesson-title" value={form.title} onChange={(event) => patchForm({ title: event.target.value })} data-lesson-authoring-title />
              </div>
              <div>
                <Label htmlFor="lesson-slug">{t.fieldSlug}</Label>
                <Input id="lesson-slug" value={form.slug} onChange={(event) => patchForm({ slug: event.target.value })} data-lesson-authoring-slug />
              </div>
              <div>
                <Label htmlFor="lesson-ref">{t.fieldSourceRef}</Label>
                <Input
                  id="lesson-ref"
                  value={form.sourceRef}
                  onChange={(event) => patchForm({ sourceRef: event.target.value })}
                  // A lesson's stable reference identifies it forever: Xulosangiz, history
                  // and every reference point at it. It is authored once, on creation.
                  readOnly={selection !== "new"}
                  disabled={selection !== "new"}
                  data-lesson-authoring-source-ref
                  data-lesson-authoring-source-ref-locked={selection !== "new" ? "true" : "false"}
                />
                {selection !== "new" ? <p className="mt-1 text-xs text-ink-300">{t.sourceRefLocked}</p> : null}
              </div>
              <div>
                <Label htmlFor="lesson-area">{t.fieldArea}</Label>
                <select
                  id="lesson-area"
                  className="input"
                  value={form.learningArea}
                  onChange={(event) => patchForm({ learningArea: event.target.value as LearningArea })}
                  data-lesson-authoring-area
                >
                  {LEARNING_AREAS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {areaLabel(candidate)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-300">{t.fieldAreaHelp}</p>
              </div>
              <div>
                <Label htmlFor="lesson-unit">{t.fieldUnit}</Label>
                <input
                  type="search"
                  className="input mb-2"
                  value={unitQuery}
                  onChange={(event) => setUnitQuery(event.target.value)}
                  placeholder={t.fieldUnitSearch}
                  aria-label={t.fieldUnitSearch}
                  aria-controls="lesson-unit"
                  data-lesson-unit-search
                />
                <select
                  id="lesson-unit"
                  className="input"
                  value={form.unitId}
                  onChange={(event) => patchForm({ unitId: event.target.value })}
                  data-lesson-authoring-unit
                >
                  {unitOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-300" role="status" data-lesson-unit-status>
                  {unitSearching
                    ? t.fieldUnitSearching
                    : unitResults
                      ? t.fieldUnitResults.replace("{n}", String(unitResults.length))
                      : ""}
                </p>
              </div>
              <div>
                <Label htmlFor="lesson-minutes">{t.fieldMinutes}</Label>
                <Input
                  id="lesson-minutes"
                  type="number"
                  min={1}
                  max={600}
                  value={form.estimatedMinutes}
                  onChange={(event) => patchForm({ estimatedMinutes: event.target.value })}
                  data-lesson-authoring-minutes
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="lesson-summary">{t.fieldDescription}</Label>
                <Textarea id="lesson-summary" value={form.summary} onChange={(event) => patchForm({ summary: event.target.value })} data-lesson-authoring-summary />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="lesson-teacher-notes">{t.fieldTeacherNotes}</Label>
                <Textarea
                  id="lesson-teacher-notes"
                  value={form.teacherNotes}
                  onChange={(event) => patchForm({ teacherNotes: event.target.value })}
                  data-lesson-authoring-teacher-notes
                />
                <p className="mt-1 text-xs text-ink-300">{t.fieldTeacherNotesHelp}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base text-ink-900">{t.blocksTitle}</h3>
                {LESSON_BLOCK_TYPES.map((type) => (
                  <Button key={type} variant="secondary" onClick={() => addBlock(type)} data-lesson-authoring-add={type}>
                    + {t.blockTypes[type]}
                  </Button>
                ))}
              </div>
              <input ref={fileInput} type="file" className="hidden" onChange={(event) => onFilePicked(event.target.files)} data-lesson-authoring-file />
              {form.blocks.length === 0 ? (
                <p className="text-sm text-ink-500">{t.blocksEmpty}</p>
              ) : (
                <ol className="flex flex-col gap-2" data-lesson-authoring-blocks>
                  {form.blocks.map((block, index) => (
                    <li key={block.localId} className="rounded-xl border border-ink-100 p-3" data-lesson-authoring-block={block.type}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs uppercase tracking-wide text-ink-300">
                          {index + 1}. {t.blockTypes[block.type as keyof typeof t.blockTypes] ?? block.type}
                        </span>
                        <span className="flex items-center gap-1">
                          <Button variant="secondary" onClick={() => moveBlock(block.localId, -1)} aria-label={t.moveUp}>
                            ↑
                          </Button>
                          <Button variant="secondary" onClick={() => moveBlock(block.localId, 1)} aria-label={t.moveDown}>
                            ↓
                          </Button>
                          <Button variant="secondary" onClick={() => removeBlock(block.localId)} aria-label={t.removeBlock} data-lesson-authoring-remove>
                            ✕
                          </Button>
                        </span>
                      </div>

                      {(block.type === "text" || block.type === "link") && (
                        <Textarea
                          className="mt-2"
                          value={block.text ?? ""}
                          onChange={(event) => patchBlock(block.localId, { text: event.target.value })}
                          placeholder={t.blockTextPlaceholder}
                        />
                      )}
                      {block.type === "link" && (
                        <Input className="mt-2" value={block.url ?? ""} onChange={(event) => patchBlock(block.localId, { url: event.target.value })} placeholder="https://" />
                      )}

                      {MEDIA_KINDS[block.type] && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                          <Button variant="secondary" onClick={() => pickFile(block)} data-lesson-authoring-upload>
                            {block.objectKey ? t.replaceFile : t.chooseFile}
                          </Button>
                          {block.uploadState === "uploading" && (
                            <span data-lesson-authoring-upload-state="uploading">
                              {t.uploading} {block.progress}%
                            </span>
                          )}
                          {block.uploadState === "failed" && (
                            <span className="text-band-bad" data-lesson-authoring-upload-state="failed">
                              {block.uploadError}
                            </span>
                          )}
                          {block.objectKey && <span data-lesson-authoring-object={block.objectKey}>{block.originalName ?? block.objectKey}</span>}
                          <span className="text-ink-300">{t.mediaKeepHint}</span>
                        </div>
                      )}

                      {block.type === "quiz" && (
                        <div className="mt-2 flex flex-col gap-2">
                          <select
                            className="input"
                            aria-label={t.quizType}
                            value={block.quiz?.questionType ?? "mcq_single"}
                            onChange={(event) =>
                              patchBlock(block.localId, { quiz: { ...(block.quiz ?? { prompt: "", options: null, answer: "", explanation: null }), questionType: event.target.value } })
                            }
                            data-lesson-authoring-quiz-type
                          >
                            {QUESTION_TYPES.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={block.quiz?.prompt ?? ""}
                            onChange={(event) =>
                              patchBlock(block.localId, { quiz: { ...(block.quiz ?? { questionType: "mcq_single", options: null, answer: "", explanation: null }), prompt: event.target.value } })
                            }
                            placeholder={t.quizPrompt}
                          />
                          <Textarea
                            value={(block.quiz?.options ?? []).join("\n")}
                            onChange={(event) =>
                              patchBlock(block.localId, {
                                quiz: {
                                  ...(block.quiz ?? { questionType: "mcq_single", prompt: "", answer: "", explanation: null }),
                                  options: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
                                },
                              })
                            }
                            placeholder={t.quizOptionsLabel}
                          />
                          <Input
                            value={block.quiz?.answer ?? ""}
                            onChange={(event) =>
                              patchBlock(block.localId, { quiz: { ...(block.quiz ?? { questionType: "mcq_single", prompt: "", options: null, explanation: null }), answer: event.target.value } })
                            }
                            placeholder={t.quizAnswer}
                          />
                          <Input
                            value={block.quiz?.explanation ?? ""}
                            onChange={(event) =>
                              patchBlock(block.localId, { quiz: { ...(block.quiz ?? { questionType: "mcq_single", prompt: "", options: null, answer: "" }), explanation: event.target.value } })
                            }
                            placeholder={t.quizExplanation}
                          />
                        </div>
                      )}

                      {block.type === "content_reference" && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <Input
                            value={block.ref?.module ?? ""}
                            onChange={(event) => patchBlock(block.localId, { ref: { ...(block.ref ?? { contentType: "video_lesson", sourceRef: "", versionId: null }), module: event.target.value } })}
                            placeholder={t.refModule}
                          />
                          <Input
                            value={block.ref?.contentType ?? ""}
                            onChange={(event) => patchBlock(block.localId, { ref: { ...(block.ref ?? { module: "ted", sourceRef: "", versionId: null }), contentType: event.target.value } })}
                            placeholder={t.refContentType}
                          />
                          <Input
                            value={block.ref?.sourceRef ?? ""}
                            onChange={(event) => patchBlock(block.localId, { ref: { ...(block.ref ?? { module: "ted", contentType: "video_lesson", versionId: null }), sourceRef: event.target.value } })}
                            placeholder={t.refSourceRef}
                          />
                          <p className="text-xs text-ink-300 sm:col-span-3">{t.referenceHint}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void save()} disabled={busy || liveWithoutDraft} data-lesson-authoring-save>
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
                  <Button variant="secondary" disabled={!editableDraft || busy} onClick={() => void movePublication("published")} data-lesson-authoring-publish>
                    {t.publish}
                  </Button>
                  <Button variant="secondary" disabled={!editableDraft || busy || !publishAt} onClick={() => void movePublication("scheduled")} data-lesson-authoring-schedule>
                    {t.schedule}
                  </Button>
                  <Button variant="secondary" disabled={!editableDraft || busy} onClick={() => void movePublication("archived")} data-lesson-authoring-archive>
                    {t.archive}
                  </Button>
                </>
              ) : (
                <span className="text-xs text-ink-300" data-lesson-authoring-no-publish>
                  {t.cannotPublish}
                </span>
              )}
            </div>

            {editableDraft && !canPublish ? <p className="text-xs text-ink-300">{t.draftSaveHint}</p> : null}

            {issues.length > 0 && (
              <div className="rounded-xl border border-band-bad/40 p-3" data-lesson-authoring-issues>
                <p className="text-sm font-medium text-band-bad">{t.issuesTitle}</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
                  {issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`} data-lesson-authoring-issue={issue.code}>
                      {issue.field ? `${issue.field}: ` : ""}
                      {describeIssue(issue)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {notice ? (
              <p className="text-sm text-band-good" data-lesson-authoring-message>
                {notice}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
