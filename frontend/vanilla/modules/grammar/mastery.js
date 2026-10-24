import {h} from '../../js/native.js';
import {Card} from '../../js/generated/ui.js';

/** Display denominator from the original `MASTERY_SESSIONS`. Every value shown is server-computed. */
export const MASTERY_SESSIONS_DISPLAY = 3;

/** Topic mastery card. The rule is shown, not implied (the original TopicMasteryCard). */
export function TopicMasteryCard({dict, mastery}) {
  const t = dict.grammar;
  const label = {correct_it: t.correctIt, translate_it: t.translateTitle, activate_it: t.activateTitle};
  const state = mastery.mastered ? 'mastered' : 'in-progress';
  return h(Card, {'data-topic-mastery': state},
    h('div', {class: 'flex flex-wrap items-center justify-between gap-2'},
      h('h2', {class: 'font-display text-lg text-ink-900'}, t.masteryTitle),
      h('span', {
        class: `badge ${mastery.mastered ? 'bg-band-good/10 text-band-good' : 'bg-paper-sunken text-ink-500'}`,
        'data-mastery-state': state,
      }, mastery.mastered ? t.masteryMastered : t.masteryInProgress)),
    h('div', {class: 'mt-3 flex flex-wrap items-center gap-4 text-sm text-ink-700'},
      h('span', {'data-mastery-score': mastery.scorePercent}, `${t.masteryScore}: ${mastery.scorePercent}%`),
      h('span', {'data-mastery-sessions': mastery.sessions}, `${t.masterySessions}: ${mastery.sessions} ${t.masteryOf} ${MASTERY_SESSIONS_DISPLAY}`)),
    h('ul', {class: 'mt-3 flex flex-col gap-1'},
      mastery.byActivity.map(entry => h('li', {
        key: entry.activity,
        class: 'flex items-center justify-between text-xs text-ink-500',
      },
        h('span', null, label[entry.activity] ?? entry.activity),
        h('span', {'data-mastery-activity': entry.activity},
          entry.attempted === 0 ? t.masteryNotPractised : `${entry.percent}% · ${entry.correct}/${entry.attempted}`)))),
    h('p', {class: 'mt-3 text-xs text-ink-300'}, t.masteryRule),
    !mastery.mastered && mastery.sessionsRemaining > 0 && mastery.attempted > 0
      ? h('p', {class: 'mt-1 text-xs text-ink-300', 'data-mastery-remaining': ''},
        t.masterySessionsLeft.replace('{n}', String(mastery.sessionsRemaining)))
      : null);
}
