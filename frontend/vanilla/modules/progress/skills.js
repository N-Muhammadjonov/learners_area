import {h} from '../../js/native.js';
import {Card} from '../../js/generated/ui.js';
import {failureNode} from './shared.js';

/** Module cards from the summary projection. Zero, no score and unavailable stay distinct:
 * `null` attempts/accuracy means unavailable or not scored, never 0. Speaking has no score by design. */
export function skillCards(s, dict, refresh) {
  const t = dict.progress;
  const w = s.writing;
  const modules = [
    {key: 'reading', href: '/app/reading', attempts: s.reading?.attempts ?? null,
      value: s.reading?.accuracy == null ? null : `${s.reading.accuracy}%`,
      extra: s.reading ? `${s.reading.submitted} ${t.submitted}` : dict.errors.unknown, unavailable: s.reading === null},
    {key: 'listening', href: '/app/listening', attempts: s.listening?.attempts ?? null,
      value: s.listening?.accuracy == null ? null : `${s.listening.accuracy}%`,
      extra: s.listening ? `${s.listening.submitted} ${t.submitted}` : dict.errors.unknown, unavailable: s.listening === null},
    {key: 'writing', href: '/app/writing', attempts: w.submissions,
      value: w.evaluationUnavailable || w.latestBand === null ? null : `${w.latestBand}`,
      extra: w.submissions === null || w.evaluationUnavailable ? dict.errors.unknown
        : w.latestBand === null ? t.noEstimateYet : t.latestEstimate,
      unavailable: w.submissions === null || w.evaluationUnavailable},
    {key: 'speaking', href: '/app/speaking', attempts: s.speaking?.attempts ?? null, value: null,
      extra: s.speaking ? `${s.speaking.transcribed} ${t.transcribed}` : dict.errors.unknown, unavailable: s.speaking === null},
  ];
  const notices = s.unavailableRegions.map(region => failureNode({
    region, message: dict.errors.unknown, retry: dict.errorPage.retry, refresh,
  }));
  return h('div', {class: 'flex flex-col gap-3'}, ...notices, h(Card, {'data-progress-modules': ''},
    h('h2', {class: 'mb-3 font-display text-lg text-ink-900'}, t.byModule),
    h('div', {class: 'grid grid-cols-2 gap-3 sm:grid-cols-4'}, modules.map(m => h('a', {
      href: m.href, class: 'rounded-sm border border-ink-100 p-3 hover:bg-paper-sunken',
      'data-progress-module': m.key, 'data-progress-attempts': m.attempts ?? 'unavailable',
    },
      h('p', {class: 'text-sm font-medium text-ink-900'}, dict.nav[m.key]),
      h('p', {class: 'mt-1 text-xs text-ink-300'}, m.attempts === null ? '—' : `${m.attempts} ${t.attempts}`),
      h('p', {class: 'mt-2 text-sm text-ink-900', 'data-progress-value': m.unavailable ? 'unavailable' : (m.value ?? 'none')},
        m.unavailable ? '—' : (m.value ?? t.noScore)),
      h('p', {class: 'text-xs text-ink-300'}, m.extra)))),
    h('p', {class: 'mt-3 text-xs text-ink-300', 'data-progress-note': ''}, t.speakingNote)));
}
