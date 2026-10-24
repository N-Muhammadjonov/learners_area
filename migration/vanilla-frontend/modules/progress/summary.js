import {h} from '../../js/native.js';
import {Card, StatCard} from '../../js/generated/ui.js';
import {show, dlRow, failureNode} from './shared.js';

const STATES = ['new', 'learning', 'review', 'known', 'mastered', 'activated'];
const GOLD_STEPS = [0.25, 0.4, 0.55, 0.7, 0.85, 1];

/** Six-state distribution. An empty library shows real zeros; `null` means unavailable. */
export function vocabularyCard(vocabulary, dict) {
  const t = dict.progress;
  return h(Card, {'data-progress-vocabulary': ''},
    h('h2', {class: 'mb-2 font-display text-lg text-ink-900'}, t.vocabulary),
    vocabulary === null
      ? h('p', {'data-vocabulary-states-unavailable': ''}, '—')
      : vocabDistribution(vocabulary.byState, t));
}

function vocabDistribution(byState, t) {
  const total = STATES.reduce((n, s) => n + byState[s], 0);
  return h('div', {class: 'flex flex-col gap-2', 'data-vocab-distribution': ''},
    total > 0 && h('div', {class: 'flex h-3 w-full overflow-hidden rounded-full bg-ink-50', 'aria-hidden': 'true'},
      STATES.map((s, i) => byState[s] > 0 && h('span', {
        style: {width: `${(byState[s] / total) * 100}%`, background: `rgb(var(--gold) / ${GOLD_STEPS[i]})`},
      }))),
    h('ul', {class: 'flex flex-wrap gap-3 text-sm'}, STATES.map(state => h('li', {
      class: 'text-ink-500', 'data-vocab-state': state,
    }, `${t.states[state]}: `, h('span', {class: 'text-ink-900'}, String(byState[state]))))));
}

/** Course and tasks. The roadmap link points at the native IELTS course roadmap. */
export function courseCard(s, dict) {
  const t = dict.progress;
  const l = s?.lessons ?? {total: null, open: null, completed: null};
  const a = s?.assignments ?? null;
  const m = s?.mocks ?? null;
  return h(Card, {'data-progress-course': ''},
    h('h2', {class: 'mb-2 font-display text-lg text-ink-900'}, t.course),
    h('dl', {class: 'grid grid-cols-1 gap-2 text-sm sm:grid-cols-2'},
      dlRow(t.lessonsCompleted, h('span', {'data-lessons-completed': l.completed ?? undefined},
        `${show(l.completed)} / ${show(l.total)}`)),
      dlRow(t.lessonsOpen, show(l.open)),
      dlRow(t.assignmentsOpen, h('span', {'data-assignments-open': a?.open ?? undefined},
        a ? `${a.open} / ${a.total}` : '—')),
      dlRow(t.mocksTaken, m ? `${m.finished}${m.bestBand === null ? '' : ` · ${t.bestBand} ${m.bestBand}`}` : '—')),
    h('a', {class: 'btn-secondary mt-3 w-fit', href: '/app'}, `${dict.courseRoadmap.open} →`));
}

/** Streak (own region) plus due and total vocabulary (summary region). Loading shows a status
 * placeholder; a failed region shows "—" beside its own retry, never a fabricated number. */
export function statCards(state, dict, streakRefresh) {
  const pending = () => h('span', {role: 'status', 'aria-label': dict.common.loading,
    class: 'inline-block h-7 w-16 animate-pulse rounded bg-ink-50'});
  const value = (entry, read) => {
    if (entry.state === 'loading') return pending();
    if (entry.state === 'error') return '—';
    return show(read(entry.data));
  };
  const streak = state.streak;
  const summary = state.summary;
  const vocab = entry => entry.data?.vocabulary ?? null;
  return h('div', {'data-progress-stats': ''},
    streak.state === 'error' ? failureNode({region: 'progress-streak', message: dict.errors.unknown,
      retry: dict.errorPage.retry, refresh: streakRefresh}) : null,
    h('div', {class: 'grid grid-cols-2 gap-3 sm:grid-cols-3'},
      StatCard({label: dict.dashboard.streak, value: value(streak, d => d.streak)}),
      StatCard({label: dict.dashboard.vocabDue, value: summary.state === 'loading' ? pending()
        : summary.state === 'error' ? '—' : show(vocab(summary)?.due ?? null)}),
      StatCard({label: dict.progress.vocabTotal, value: summary.state === 'loading' ? pending()
        : summary.state === 'error' ? '—' : show(vocab(summary)?.total ?? null)})));
}
