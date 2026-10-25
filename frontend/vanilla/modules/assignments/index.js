import {h} from '../../js/native.js';
import {
  fetchAssignmentList, fetchAssignmentDetails, submitAssignment, MIN_RESPONSE_LENGTH, MAX_RESPONSE_LENGTH,
} from '../../js/adapters/assignments.js';
import {apiErrorMessage} from '../../js/api-error-message.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {assignmentCard} from './card.js';
import {notifyEvaluationChanged} from '../shared/events.js';

/**
 * Assignments (`/app/assignments`), native port of AssignmentBoard + the assignments page.
 *
 * Regions are independent: the assignment list (core) and the details projection (evaluation, saved response,
 * materials) each have their own loading, error and retry. A details failure never removes the list, and a
 * list failure never hides a retryable notice. Responses that arrive after unmount or a newer request are dropped.
 */
export function mount(ctx) {
  const {root, dict, locale, session, signal} = ctx;
  const t = dict.assignments;
  const isLearner = session?.user?.role === 'student';

  const host = h('div', {class: 'flex min-w-0 flex-col gap-3', 'data-assignments-list': '', 'data-async-content': 'assignments'});
  root.append(h('div', {class: 'mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4', 'data-route-usable': 'assignments'},
    h('div', {},
      h('h1', {class: 'font-display text-2xl text-ink-900'}, t.title),
      h('p', {class: 'text-sm text-ink-500'}, t.subtitle)),
    host));

  const S = {
    list: [], listState: 'loading',
    details: new Map(), detailsState: 'loading',
    drafts: new Map(), busy: new Set(), notice: new Map(), error: new Map(),
  };
  let listGeneration = 0;
  let detailsGeneration = 0;

  function paint() {
    if (signal.aborted) return;
    const focusId = document.activeElement?.getAttribute?.('data-assignment-response');
    host.replaceChildren(...content());
    if (focusId) host.querySelector(`[data-assignment-response="${CSS.escape(focusId)}"]`)?.focus();
  }

  function content() {
    if (!isLearner) return [h('p', {class: 'text-sm text-ink-500', 'data-assignments-empty': ''}, t.empty), h('p', {class: 'text-xs text-ink-300'}, t.staffNotice)];
    if (S.listState === 'loading') return [h('div', {role: 'status', 'aria-busy': 'true', 'aria-label': dict.common.loading, class: 'h-28 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': 'assignments'})];
    if (S.listState === 'error') return [RegionFailureNotice({region: 'assignments-list', message: dict.errors.unknown, retryLabel: dict.errorPage.retry, refresh: () => retryList()})];
    if (S.list.length === 0) return [h('div', {class: 'card p-4'}, h('p', {class: 'text-sm text-ink-500', 'data-assignments-empty': ''}, t.empty))];
    return S.list.map((a) => assignmentCard({
      a, dict, locale, detail: S.details.get(a.id) ?? null, detailsState: S.detailsState,
      draft: S.drafts.get(a.id), busy: S.busy, notice: S.notice, error: S.error,
      onInput, onSubmit: submit, onRetryDetails: retryDetails,
    }));
  }

  function onInput(id, value) {
    S.drafts.set(id, value);
    if (S.error.has(id)) { S.error.delete(id); }
  }

  async function loadList(fresh = false) {
    const generation = ++listGeneration;
    if (!isLearner) return;
    try {
      const list = await fetchAssignmentList(signal, {fresh});
      if (signal.aborted || generation !== listGeneration) return;
      S.list = list; S.listState = 'ready';
    } catch {
      if (signal.aborted || generation !== listGeneration) return;
      S.listState = 'error';
    }
    paint();
  }

  async function loadDetails(fresh = false) {
    const generation = ++detailsGeneration;
    if (!isLearner) return;
    S.detailsState = 'loading';
    try {
      const details = await fetchAssignmentDetails(signal, {fresh});
      if (signal.aborted || generation !== detailsGeneration) return;
      S.details = details; S.detailsState = 'ready';
      // Seed the editor with the saved response only once; a learner's unsent text is never overwritten.
      for (const [id, d] of details) if (!S.drafts.has(id) && d.response !== null) S.drafts.set(id, d.response);
    } catch {
      if (signal.aborted || generation !== detailsGeneration) return;
      S.details = new Map(); S.detailsState = 'error';
    }
    paint();
  }

  /** Each source retries on its own: a list retry never re-requests details, and a details retry never touches the list. */
  function retryList() {
    if (!isLearner) return undefined;
    S.listState = 'loading';
    paint();
    return loadList();
  }
  function retryDetails() {
    if (!isLearner) return undefined;
    S.detailsState = 'loading';
    paint();
    return loadDetails();
  }
  function reload() {
    if (!isLearner) return;
    S.listState = 'loading';
    paint();
    void loadList();
    void loadDetails();
  }

  function mapError(e) {
    if (e?.status === 502) return t.genericError;
    if (e?.name === 'TimeoutError') return t.timeout;
    return apiErrorMessage(e?.code, e?.status, dict, {
      no_submission: t.noSubmission,
      submission_not_written: t.submissionNotWritten,
      response_required: t.tooShort,
      student_response_required: t.genericError,
    });
  }

  async function submit(a) {
    const id = a.id;
    if (S.busy.has(id)) return;
    const response = (S.drafts.get(id) ?? '').trim();
    S.notice.delete(id);
    if (response.length < MIN_RESPONSE_LENGTH) { S.error.set(id, t.tooShort); paint(); return; }
    if (response.length > MAX_RESPONSE_LENGTH) { S.error.set(id, t.tooLong); paint(); return; }
    S.busy.add(id); S.error.delete(id); paint();
    let succeeded = false;
    try {
      const result = await submitAssignment(id, response, signal);
      if (signal.aborted) return;
      succeeded = true;
      S.notice.set(id, `${t.submitted} ${dict.coach.checkedBy} ${result.checkedBy}${result.verdict && dict.coach.verdicts[result.verdict] ? ` · ${dict.coach.verdicts[result.verdict]}` : ''}`);
      S.drafts.delete(id);
    } catch (e) {
      if (signal.aborted) return;
      S.error.set(id, mapError(e));
    } finally {
      S.busy.delete(id);
    }
    if (signal.aborted) return;
    paint();
    if (succeeded) {
      notifyEvaluationChanged();
      // Re-read the server: status, evaluation and saved response are the server's facts, not the browser's guess.
      await Promise.allSettled([loadList(true), loadDetails(true)]);
    }
  }

  signal.addEventListener('abort', () => { listGeneration++; detailsGeneration++; host.replaceChildren(); }, {once: true});
  paint();
  reload();
}
