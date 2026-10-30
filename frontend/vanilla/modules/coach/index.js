import {h} from '../../js/native.js';
import {fetchCoach, fetchDue} from '../../js/adapters/coach.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {EVALUATION_CHANGED} from '../shared/events.js';
import {statCard, emptyState, recommendations, openWeaknesses, improvedWeaknesses, recentEvaluations, dueChips} from './sections.js';

/**
 * AI Coach (`/app/coach`). Two independent server regions:
 *   - coach: weaknesses, evaluation history, study recommendations (PROPOSED view region, BLOCKED live)
 *   - due:   spaced-repetition vocabulary queue (real GET /api/vocabulary/due)
 * A failure in one never blanks the other. Both re-read the server on mount, on retry, and after an assignment
 * evaluation elsewhere in the app. Responses that arrive after unmount or a newer request are dropped.
 */
export function mount(ctx) {
  const {root, dict, locale, session, signal} = ctx;
  const t = dict.coach;
  const isLearner = session?.user?.role === 'student';

  const coachHost = h('div', {class: 'flex flex-col gap-6 min-w-0', 'data-coach-content': '', 'data-async-content': 'coach'});
  const dueHost = h('div', {class: 'min-w-0', 'data-coach-due-host': ''});
  root.append(h('div', {class: 'mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6', 'data-route-usable': 'coach'},
    h('a', {href: '/app', 'data-back-link': true, class: 'text-sm text-ink-500 underline w-fit'}, `← ${dict.common.back}`),
    h('div', {},
      h('h1', {class: 'font-display text-2xl text-ink-900'}, t.dashboardTitle),
      h('p', {class: 'text-sm text-ink-500'}, t.dashboardSubtitle)),
    coachHost,
    dueHost));

  const S = {coach: null, coachState: 'loading', due: null, dueState: 'loading'};
  let coachGen = 0;
  let dueGen = 0;

  function paintCoach() {
    if (signal.aborted) return;
    coachHost.replaceChildren(...coachContent());
  }
  function paintDue() {
    if (signal.aborted) return;
    dueHost.replaceChildren(...dueContent());
  }

  function coachContent() {
    if (!isLearner) return [emptyState(dict)];
    if (S.coachState === 'loading') return [h('div', {role: 'status', 'aria-busy': 'true', 'aria-label': dict.common.loading, class: 'h-40 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': 'coach'})];
    if (S.coachState === 'error') return [RegionFailureNotice({region: 'coach', message: dict.errors.unknown, retryLabel: dict.errorPage.retry, refresh: () => loadCoach()})];
    const c = S.coach;
    if (c.weaknesses.length === 0 && c.recentEvaluations.length === 0) return [emptyState(dict)];
    const open = c.weaknesses.filter((w) => w.status === 'open');
    const improved = c.weaknesses.filter((w) => w.status !== 'open');
    const improvingCount = c.weaknesses.filter((w) => w.status === 'improving').length;
    return [
      h('div', {class: 'grid gap-3 sm:grid-cols-3', 'data-coach-stats': ''},
        statCard(t.repeated, String(open.length), {'data-coach-stat': 'repeated'}),
        statCard(t.improved, String(improvingCount), {'data-coach-stat': 'improved'}),
        statCard(t.reviewToday, S.dueState === 'ready' ? String(S.due.length) : '—', {'data-coach-stat': 'review'})),
      c.recommendations.length > 0 ? recommendations(dict, c.recommendations) : null,
      open.length > 0 ? openWeaknesses(dict, locale, open) : null,
      improved.length > 0 ? improvedWeaknesses(dict, improved) : null,
      c.recentEvaluations.length > 0 ? recentEvaluations(dict, locale, c.recentEvaluations) : null,
    ].filter(Boolean);
  }

  function dueContent() {
    if (!isLearner) return [];
    if (S.dueState === 'loading') return [h('div', {role: 'status', 'aria-busy': 'true', 'aria-label': dict.common.loading, class: 'h-16 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': 'due'})];
    if (S.dueState === 'error') return [RegionFailureNotice({region: 'coach-due', message: dict.errors.unknown, retryLabel: dict.errorPage.retry, refresh: () => loadDue()})];
    if (S.due.length === 0) return [h('p', {class: 'text-sm text-ink-500', 'data-coach-due-empty': ''}, t.noDueToday)];
    return [dueChips(dict, S.due)];
  }

  async function loadCoach(fresh = false) {
    const gen = ++coachGen;
    if (!isLearner) return;
    S.coachState = 'loading'; paintCoach();
    try {
      const coach = await fetchCoach(signal, {fresh});
      if (signal.aborted || gen !== coachGen) return;
      S.coach = coach; S.coachState = 'ready';
    } catch {
      if (signal.aborted || gen !== coachGen) return;
      S.coach = null; S.coachState = 'error';
    }
    paintCoach();
  }

  async function loadDue(fresh = false) {
    const gen = ++dueGen;
    if (!isLearner) return;
    S.dueState = 'loading'; paintDue(); paintCoach();
    try {
      const due = await fetchDue(signal, 10, {fresh});
      if (signal.aborted || gen !== dueGen) return;
      S.due = due; S.dueState = 'ready';
    } catch {
      if (signal.aborted || gen !== dueGen) return;
      S.due = null; S.dueState = 'error';
    }
    paintDue(); paintCoach();
  }

  function reloadAll(fresh = false) {
    void loadCoach(fresh);
    void loadDue(fresh);
  }

  // Another module changed the server's evaluation state (an assignment was evaluated). Re-read; never patch locally.
  const onChanged = () => { if (isLearner && !signal.aborted) reloadAll(true); };
  window.addEventListener(EVALUATION_CHANGED, onChanged);
  signal.addEventListener('abort', () => {
    window.removeEventListener(EVALUATION_CHANGED, onChanged);
    coachGen++; dueGen++;
    coachHost.replaceChildren(); dueHost.replaceChildren();
  }, {once: true});

  paintCoach(); paintDue();
  reloadAll();
}
