import {h} from '../../js/native.js';
import {mockDTO} from '../../js/adapters/dashboard.js';
import {projection, loadingNode, failureNode} from '../shared/region.js';
import {Card} from '../../js/generated/ui.js';

/** Mock tests (`/app/mocks`), a native port of the original page. The original has NO timed runner:
 * `startMockAttempt` has no caller, there is no mock API route, and the page itself says the runner is
 * not enabled. So this page shows only the configured catalogue and the learner's own recorded attempts.
 * It never renders a start, timer or submit control, and never invents a band. Attempt rows come from the
 * existing `mock` region projection, validated by `mockDTO`. */
export async function mount(context) {
  const {root, url, signal, dict} = context;
  const t = dict.mocks;
  const route = url.pathname;
  const retry = dict.errorPage.retry;
  const host = h('div', {class: 'flex flex-col gap-4', 'data-mocks-host': ''});
  root.append(h('div', {class: 'mx-auto flex max-w-3xl flex-col gap-4', 'data-route-usable': 'mocks'},
    h('div', {},
      h('h1', {class: 'font-display text-2xl text-ink-900'}, dict.nav.mocks),
      h('p', {class: 'text-sm text-ink-500'}, t.subtitle)),
    h(Card, {'data-mocks-runner-note': '', className: 'border-gold/40'},
      h('p', {class: 'text-sm text-ink-700'}, t.runnerNote)),
    host));

  const refresh = projection({
    route, region: 'mock', signal, parse: mockDTO,
    loading() { host.replaceChildren(loadingNode(dict, 'mocks')); },
    ready(data) { host.replaceChildren(mocksContent(data, dict, () => refresh())); },
    failed(again) {
      host.replaceChildren(failureNode({region: 'mocks', message: dict.errors.unknown, retry, refresh: again}));
    },
  });
  void refresh();
}

function notice(region, dict, refresh) {
  return failureNode({region, message: dict.errors.unknown, retry: dict.errorPage.retry, refresh});
}

function attemptState(dict, attempt) {
  const t = dict.mocks;
  if (!attempt.finishedAt) return t.unfinished;
  return `${t.band} ${attempt.estimatedBand ?? '—'} · ${attempt.rawScore ?? '—'} ${t.raw}`;
}

/** Original MocksContent. Each unavailable part shows its own notice; the rest keeps rendering. */
export function mocksContent(data, dict, refresh) {
  const t = dict.mocks;
  const catalogueCard = h(Card, {'data-mocks-catalogue': ''},
    h('h2', {class: 'mb-2 font-display text-lg text-ink-900'}, t.catalogue),
    data.catalogueUnavailable ? null
      : data.tests.length === 0 ? h('p', {class: 'text-sm text-ink-500', 'data-mocks-empty': ''}, t.noTests)
        : h('ul', {class: 'flex flex-col divide-y divide-ink-100'}, data.tests.map(test => h('li', {
          class: 'flex items-center justify-between py-2', 'data-mock-test': test.id,
        },
        h('span', {class: 'text-sm text-ink-900'}, test.title),
        h('span', {class: 'text-xs text-ink-300'}, test.skill)))),
    data.catalogueTruncated ? h('p', {class: 'mt-2 text-xs text-ink-500', 'data-mock-catalogue-truncated': ''}, t.catalogueTruncated) : null);
  const attemptsCard = h(Card, {'data-mocks-attempts': ''},
    h('div', {class: 'flex items-center justify-between'},
      h('h2', {class: 'font-display text-lg text-ink-900'}, t.myAttempts),
      data.attemptsUnavailable ? null
        : h('span', {class: 'text-sm text-ink-500', 'data-mocks-finished': String(data.finishedCount)},
          `${data.finishedCount} ${t.finished}`)),
    data.attemptsUnavailable ? null
      : data.attempts.length === 0 ? h('p', {class: 'mt-2 text-sm text-ink-500', 'data-mocks-attempts-empty': ''}, t.noAttempts)
        : h('ul', {class: 'mt-2 flex flex-col divide-y divide-ink-100'}, data.attempts.map(attempt => h('li', {
          class: 'flex items-center justify-between gap-3 py-2', 'data-mock-attempt': attempt.id,
        },
        h('span', {class: 'min-w-0 text-sm text-ink-900'}, attempt.title ?? t.untitled),
        h('span', {
          class: 'shrink-0 text-xs text-ink-300',
          'data-mock-state': attempt.finishedAt ? 'finished' : 'unfinished',
        }, attemptState(dict, attempt))))),
    h('p', {class: 'mt-3 text-xs text-ink-300'}, t.unfinishedNote),
    data.attemptsTruncated ? h('p', {class: 'mt-2 text-xs text-ink-500', 'data-mock-attempts-truncated': ''}, t.attemptsTruncated) : null);
  return h('div', {class: 'flex flex-col gap-4', 'data-mocks-content': '', 'data-async-content': 'mocks'},
    data.catalogueUnavailable ? notice('mocks-catalogue', dict, refresh) : null,
    data.attemptsUnavailable ? notice('mocks-attempts', dict, refresh) : null,
    data.attemptTitlesUnavailable ? notice('mocks-attempt-titles', dict, refresh) : null,
    catalogueCard,
    attemptsCard);
}
