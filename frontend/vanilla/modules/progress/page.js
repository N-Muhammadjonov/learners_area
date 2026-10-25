import {h} from '../../js/native.js';
import {
  progressSummaryDTO, progressStreakDTO, progressTrendsDTO, progressMocksDTO,
} from '../../js/adapters/progress-v54.js';
import {projection, loadingNode, failureNode} from './shared.js';
import {skillCards} from './skills.js';
import {trendCards} from './trends.js';
import {statCards, vocabularyCard, courseCard} from './summary.js';
import {mockOverview} from './mocks.js';

/** My Progress (`/app/progress`). Six independent projection regions on one route: summary (skills,
 * vocabulary, course), streak, trends and mocks. Each has its own loading, failure and retry state.
 * Responses that arrive after a newer request, a retry or unmount are ignored. */
export async function mount(context) {
  const {root, url, signal, dict, locale} = context;
  const uz = locale === 'uz';
  const route = url.pathname;
  const retry = dict.errorPage.retry;
  const mockMessage = uz ? "Mock natijalarini yuklab bo'lmadi." : 'Mock results could not be loaded.';
  const mockRetry = uz ? 'Qayta urinish' : 'Retry';
  const pulse = () => h('div', {class: 'h-32 animate-pulse rounded-xl bg-ink-50', 'aria-hidden': 'true'});

  const mocksHost = h('section', {class: 'min-w-0', 'data-progress-mocks-host': ''});
  const modulesHost = h('div', {'data-progress-summary-host': ''});
  const trendsHost = h('div', {'data-progress-trends-host': ''});
  const statsHost = h('div', {'data-progress-stats-host': ''});
  const vocabHost = h('div', {'data-progress-vocabulary-host': ''});
  const courseHost = h('div', {'data-progress-course-host': ''});
  const page = h('div', {class: 'mx-auto flex max-w-6xl flex-col gap-4', 'data-route-usable': 'progress'},
    h('div', {},
      h('h1', {class: 'font-display text-2xl text-ink-900'}, dict.nav.progress),
      h('p', {class: 'text-sm text-ink-500'}, dict.progress.subtitle),
      h('a', {class: 'mt-1 inline-block text-sm font-semibold text-ink-900 underline', href: '/app/reports', 'data-progress-reports-link': ''},
        dict.reporter.openFromProgress)),
    mocksHost,
    h('div', {class: 'flex flex-col gap-4', 'data-progress-content': '', 'data-async-content': 'progress'},
      modulesHost, trendsHost, statsHost, vocabHost, courseHost));
  root.append(page);

  const state = {streak: {state: 'loading'}, summary: {state: 'loading'}};
  const renderStats = () => statsHost.replaceChildren(statCards(state, dict, () => refreshStreak()));

  const refreshSummary = projection({
    route, region: 'progressSummary', signal, parse: progressSummaryDTO,
    loading() {
      state.summary = {state: 'loading'};
      renderStats();
      modulesHost.replaceChildren(loadingNode(dict, 'progress-summary'));
      vocabHost.replaceChildren(pulse());
      courseHost.replaceChildren(pulse());
    },
    ready(summary) {
      state.summary = {state: 'ready', data: summary};
      modulesHost.replaceChildren(skillCards(summary, dict, () => refreshSummary()));
      vocabHost.replaceChildren(vocabularyCard(summary.vocabulary, dict));
      courseHost.replaceChildren(courseCard(summary, dict));
      renderStats();
    },
    failed(refresh) {
      state.summary = {state: 'error'};
      modulesHost.replaceChildren(failureNode({region: 'progress-summary', message: dict.errors.unknown, retry, refresh}));
      vocabHost.replaceChildren(vocabularyCard(null, dict));
      courseHost.replaceChildren(courseCard(null, dict));
      renderStats();
    },
  });

  const refreshStreak = projection({
    route, region: 'progressStreak', signal, parse: progressStreakDTO,
    loading() { state.streak = {state: 'loading'}; renderStats(); },
    ready(streak) { state.streak = {state: 'ready', data: streak}; renderStats(); },
    failed() { state.streak = {state: 'error'}; renderStats(); },
  });

  const refreshTrends = projection({
    route, region: 'progressTrends', signal, parse: progressTrendsDTO,
    loading() { trendsHost.replaceChildren(loadingNode(dict, 'progress-trends')); },
    ready(trends) { trendsHost.replaceChildren(trendCards(trends, dict)); },
    failed(refresh) {
      trendsHost.replaceChildren(failureNode({region: 'progress-trends', message: dict.errors.unknown, retry, refresh}));
    },
  });

  const mockFailure = refresh => failureNode({region: 'mock-overview', message: mockMessage, retry: mockRetry, refresh});
  const refreshMocks = projection({
    route, region: 'progressMocks', signal, parse: progressMocksDTO,
    loading() { mocksHost.replaceChildren(loadingNode(dict, 'progress-mocks')); },
    ready(dto) {
      if (dto.attemptsUnavailable || dto.attemptTitlesUnavailable) {
        mocksHost.replaceChildren(mockFailure(() => refreshMocks()));
        return;
      }
      mocksHost.replaceChildren(mockOverview(dto, uz, mockFailure(() => refreshMocks())));
    },
    failed(refresh) { mocksHost.replaceChildren(mockFailure(refresh)); },
  });

  renderStats();
  void refreshSummary();
  void refreshStreak();
  void refreshTrends();
  void refreshMocks();
}
