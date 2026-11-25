import {h} from '../../js/native.js';
import {
  progressSummaryDTO, progressStreakDTO, progressTrendsDTO,
} from '../../js/adapters/progress-v54.js';
import {projection, loadingNode, failureNode} from './shared.js';
import {skillCards} from './skills.js';
import {trendCards} from './trends.js';
import {statCards, vocabularyCard, courseCard} from './summary.js';
import {attemptBandCards} from './attempt-bands.js';
import {learnerJourney} from '../shared/learner-journey.js';
import {studentCalendar} from '../staff-final30/academy-attendance.js';

/** My Progress (`/app/progress`). Summary, streak and trends have independent regions.
 * Trends also supplies the Reading and Listening attempt cards. Each has its own loading, failure and retry state.
 * Responses that arrive after a newer request, a retry or unmount are ignored. */
export async function mount(context) {
  const {root, url, signal, dict, locale} = context;
  const uz = locale === 'uz';
  const route = url.pathname;
  const retry = dict.errorPage.retry;
  const pulse = () => h('div', {class: 'h-32 animate-pulse rounded-xl bg-ink-50', 'aria-hidden': 'true'});

  const bandsHost = h('div', {'data-progress-bands-host': ''});
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
    bandsHost,
    h('div', {class: 'flex flex-col gap-4', 'data-progress-content': '', 'data-async-content': 'progress'},
      modulesHost, trendsHost, statsHost, vocabHost, courseHost));
  root.append(page);
  if(context.session?.paymentsEnabled===true&&context.session.user.role==='student')page.firstElementChild.append(
    h('a',{href:'/app/payments',class:'btn-primary'},uz?'Mening to‘lovlarim':'My payments'));
  if(context.session?.user?.role==='student'){
    const calendar=studentCalendar(context);
    if(calendar)page.append(calendar);
    const journey=learnerJourney(context,'/api/academy/journey');
    if(journey)page.append(journey);
  }

  const state = {streak: {state: 'loading'}, summary: {state: 'loading'}};
  const renderStats = () => statsHost.replaceChildren(statCards(state, dict, () => refreshStreak()));

  const refreshSummary = projection({
    lifecycle:context, route, region: 'progressSummary', signal, parse: progressSummaryDTO,
    loading() {
      state.summary = {state: 'loading'};
      renderStats();
      modulesHost.replaceChildren(loadingNode(dict, 'progress-summary'));
      vocabHost.replaceChildren(pulse());
      courseHost.replaceChildren(pulse());
    },
    ready(summary) {
      state.summary = {state: 'ready', data: summary};
      modulesHost.replaceChildren(skillCards(summary, dict, () => refreshSummary(), {showAttemptAccuracy: false}));
      vocabHost.replaceChildren(vocabularyCard(summary.vocabulary, dict));
      courseHost.replaceChildren(courseCard(summary, dict, {showMocks: false}));
      renderStats();
    },
    failed(refresh) {
      state.summary = {state: 'error'};
      modulesHost.replaceChildren(failureNode({region: 'progress-summary', message: dict.errors.unknown, retry, refresh}));
      vocabHost.replaceChildren(vocabularyCard(null, dict));
      courseHost.replaceChildren(courseCard(null, dict, {showMocks: false}));
      renderStats();
    },
  });

  const refreshStreak = projection({
    lifecycle:context, route, region: 'progressStreak', signal, parse: progressStreakDTO,
    loading() { state.streak = {state: 'loading'}; renderStats(); },
    ready(streak) { state.streak = {state: 'ready', data: streak}; renderStats(); },
    failed() { state.streak = {state: 'error'}; renderStats(); },
  });

  const refreshTrends = projection({
    lifecycle:context, route, region: 'progressTrends', signal, parse: progressTrendsDTO,
    loading() {
      bandsHost.replaceChildren(loadingNode(dict, 'progress-attempt-bands'));
      trendsHost.replaceChildren(loadingNode(dict, 'progress-trends'));
    },
    ready(trends) {
      bandsHost.replaceChildren(attemptBandCards(trends.attemptBands, trends.generalReadingPractice, dict, locale, refreshTrends));
      trendsHost.replaceChildren(trendCards(trends, dict));
    },
    failed(refresh) {
      bandsHost.replaceChildren(failureNode({region: 'progress-attempt-bands', message: dict.errors.unknown, retry, refresh}));
      trendsHost.replaceChildren(failureNode({region: 'progress-trends', message: dict.errors.unknown, retry, refresh}));
    },
  });

  context.onResume?.(()=>{for(const refresh of [refreshSummary,refreshStreak,refreshTrends])void refresh({background:true});});
  renderStats();
  void refreshSummary();
  void refreshStreak();
  void refreshTrends();
}
