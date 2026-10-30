import {h} from '../../js/native.js';
import {fmtDate} from '../shared/dates.js';

/*
 * Presentation only. Counts are row counts of server rows; ordering of recommendations is the server's; no value is
 * computed from anything the server did not send (no severity, score, band or advice is invented here).
 */

const countText = (template, n) => template.replace('{count}', String(n));
const categoryName = (dict, code) => dict.coach.categoryLabels[code] ?? '';
const areaName = (dict, area) => dict.nav[area] ?? '';

export function statCard(label, value, attrs = {}) {
  return h('div', {class: 'card flex flex-col gap-1 p-4', ...attrs},
    h('span', {class: 'text-xs uppercase tracking-wide text-ink-300'}, label),
    h('span', {class: 'font-display text-2xl text-ink-900'}, value));
}

export function emptyState(dict) {
  return h('div', {class: 'card flex flex-col items-start gap-3 p-6', 'data-coach-empty': ''},
    h('p', {class: 'text-sm text-ink-700'}, dict.coach.noWeaknessesYet),
    h('a', {href: '/app/writing', class: 'btn-primary'}, dict.dashboard.startWriting));
}

function recommendationCard(dict, r) {
  const t = dict.coach;
  const names = r.categories.map((c) => categoryName(dict, c)).join(' · ');
  return h('article', {class: 'card flex min-w-0 flex-col gap-2 p-4', 'data-study-recommendation': r.area},
    h('span', {class: 'text-xs uppercase tracking-wide text-ink-300'}, areaName(dict, r.area)),
    h('span', {class: 'text-sm font-medium text-ink-900'}, names),
    h('span', {class: 'text-xs text-ink-500'}, r.reason),
    h('span', {class: 'text-xs text-ink-300'}, countText(t.seenTimes, r.occurrenceCount)),
    h('a', {href: r.href, class: 'btn-secondary self-start'}, t.startPractising));
}

export function recommendations(dict, items) {
  const t = dict.coach;
  const cards = items.map((r) => recommendationCard(dict, r));
  return h('section', {class: 'flex flex-col gap-3', 'aria-labelledby': 'coach-practice-now', 'data-coach-recommendations': ''},
    h('h2', {id: 'coach-practice-now', class: 'font-display text-lg text-ink-900'}, t.practiceNow),
    h('div', {class: 'grid gap-3 sm:grid-cols-2'}, cards));
}

function openRow(dict, locale, w) {
  const t = dict.coach;
  const detail = `${countText(t.seenTimes, w.occurrenceCount)} · ${t.lastSeen} ${fmtDate(w.lastSeenAt, locale)} · ${t.severity[w.recentSeverity] ?? ''}`;
  return h('article', {class: 'card flex flex-col gap-1 p-4', 'data-coach-weakness': w.category, 'data-status': w.status},
    h('span', {class: 'text-sm font-medium text-ink-900'}, categoryName(dict, w.category)),
    h('span', {class: 'text-xs text-ink-300'}, detail),
    h('span', {class: 'text-xs text-ink-500'}, w.action));
}

export function openWeaknesses(dict, locale, items) {
  // Display order only: the most-repeated pattern first. The server's data is not changed.
  const sorted = [...items].sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  return h('section', {class: 'flex flex-col gap-3', 'aria-labelledby': 'coach-repeated', 'data-coach-open': ''},
    h('h2', {id: 'coach-repeated', class: 'font-display text-lg text-ink-900'}, dict.coach.repeated),
    sorted.map((w) => openRow(dict, locale, w)));
}

function statusLabel(t, status) {
  if (status === 'open') return t.statusOpen;
  if (status === 'improving') return t.statusImproving;
  return t.statusResolved;
}

export function improvedWeaknesses(dict, items) {
  const t = dict.coach;
  const rows = items.map((w) => h('div', {class: 'flex items-center justify-between gap-2', 'data-status': w.status},
    h('span', {class: 'text-sm text-ink-700'}, categoryName(dict, w.category)),
    h('span', {class: 'badge'}, statusLabel(t, w.status))));
  return h('section', {class: 'flex flex-col gap-3', 'aria-labelledby': 'coach-improved', 'data-coach-improved': ''},
    h('h2', {id: 'coach-improved', class: 'font-display text-lg text-ink-900'}, t.improved),
    h('div', {class: 'card flex flex-col gap-2 p-4'}, rows));
}

function evaluationRow(dict, locale, row) {
  const t = dict.coach;
  const type = dict.nav[row.evaluationType] ?? '';
  let result = '—';
  if (row.overallEstimate !== null) result = `${t.estimatedBand}: ${row.overallEstimate.toFixed(1)}`;
  else if (row.verdict && t.verdicts[row.verdict]) result = t.verdicts[row.verdict];
  return h('div', {
    class: 'flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 py-2', 'data-evaluation-id': row.id,
  },
  h('span', {class: 'text-sm text-ink-700'}, type),
  h('span', {class: 'flex flex-wrap items-center gap-2 text-xs text-ink-300'},
    result,
    h('span', {class: 'badge', 'data-checked-by': row.checkedByName}, `${t.checkedBy} ${row.checkedByName}`),
    h('time', {datetime: row.createdAt}, fmtDate(row.createdAt, locale))));
}

export function recentEvaluations(dict, locale, items) {
  return h('section', {class: 'flex flex-col gap-3', 'aria-labelledby': 'coach-recent', 'data-coach-recent': ''},
    h('h2', {id: 'coach-recent', class: 'font-display text-lg text-ink-900'}, dict.coach.recentEvaluations),
    h('div', {class: 'card flex flex-col p-4'}, items.map((row) => evaluationRow(dict, locale, row))));
}

export function dueChips(dict, items) {
  const v = dict.vocabulary;
  const chips = items.map((w) => h('span', {class: 'badge', 'data-due-term': w.id}, w.term));
  return h('section', {class: 'flex flex-col gap-3', 'aria-labelledby': 'coach-review', 'data-coach-due': ''},
    h('h2', {id: 'coach-review', class: 'font-display text-lg text-ink-900'}, dict.coach.reviewToday),
    h('div', {class: 'card flex flex-wrap items-center gap-2 p-4'},
      chips,
      h('a', {href: '/app/vocabulary?tab=revision', class: 'text-sm text-signal-700 underline'}, v.review)));
}
