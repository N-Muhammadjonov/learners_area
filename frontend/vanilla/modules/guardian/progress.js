import {h} from '../../js/native.js';
import {progressSummaryDTO, progressStreakDTO, progressTrendsDTO, progressMocksDTO} from '../../js/adapters/progress-v54.js';
import {loadingNode, failureNode} from '../progress/shared.js';
import {skillCards} from '../progress/skills.js';
import {trendCards} from '../progress/trends.js';
import {statCards, vocabularyCard, courseCard} from '../progress/summary.js';
import {mockOverview} from '../progress/mocks.js';
import {api, loadStyles, tr, marker, failureText, loadChildren, childPicker, emptyState} from './shared.js';

/** Guardian "My Progress": the child's real My Progress regions, read-only. Renders the SAME components as the
 * student page, but only through /api/guardian/children/{id}/progress. No actions, no links to other modules. */
export async function mount(ctx) {
  loadStyles();
  const {root, signal, dict} = ctx;
  const page = h('div', {class: 'pc-page', 'data-route-usable': 'guardian-progress'});
  root.append(page);
  page.append(h('p', {role: 'status'}, dict.common.loading));
  let kids;
  try { kids = await loadChildren(ctx); } catch (error) {
    if (signal.aborted) return;
    page.replaceChildren(h('div', {class: 'pc-card', role: 'alert'}, failureText(ctx, error)));
    return;
  }
  if (signal.aborted) return;
  const draw = child => {
    const state = {streak: {state: 'loading'}, summary: {state: 'loading'}};
    const modulesHost = h('div'), trendsHost = h('div'), statsHost = h('div'), vocabHost = h('div'), courseHost = h('div'), mocksHost = h('section', {class: 'min-w-0'});
    const renderStats = () => statsHost.replaceChildren(statCards(state, dict, () => load('progressStreak')));
    const kinds = {
      progressSummary: {parse: progressSummaryDTO, ready: d => { state.summary = {state: 'ready', data: d};
        modulesHost.replaceChildren(skillCards(d, dict, () => load('progressSummary')));
        vocabHost.replaceChildren(vocabularyCard(d.vocabulary, dict)); courseHost.replaceChildren(courseCard(d, dict)); renderStats(); }, host: modulesHost},
      progressStreak: {parse: progressStreakDTO, ready: d => { state.streak = {state: 'ready', data: d}; renderStats(); }, host: statsHost},
      progressTrends: {parse: progressTrendsDTO, ready: d => trendsHost.replaceChildren(trendCards(d, dict)), host: trendsHost},
      progressMocks: {parse: progressMocksDTO, ready: d => mocksHost.replaceChildren(mockOverview(d, ctx.locale === 'uz', failureNode({region: 'mock-overview', message: dict.errors.unknown, retry: dict.errorPage.retry, refresh: () => load('progressMocks')}))), host: mocksHost},
    };
    async function load(region) {
      const k = kinds[region];
      try {
        const body = await api(`/api/guardian/children/${encodeURIComponent(child.studentId)}/progress?region=${region}`, {signal});
        if (signal.aborted) return;
        k.ready(k.parse(body.data[region]));
      } catch (error) {
        if (signal.aborted) return;
        if (region === 'progressStreak') { state.streak = {state: 'error'}; renderStats(); return; }
        k.host.replaceChildren(failureNode({region, message: failureText(ctx, error), retry: dict.errorPage.retry, refresh: () => load(region)}));
      }
    }
    page.replaceChildren(
      h('div', {class: 'flex flex-wrap items-center justify-between gap-2'},
        h('div', {},
          h('h1', {class: 'font-display text-2xl text-ink-900'}, `${child.name} — ${dict.nav.progress}`),
          h('p', {class: 'pc-muted'}, tr(ctx, 'Faqat tasdiqlangan farzandingizning natijalari', 'Results of your approved child only'))),
        marker(ctx)),
      childPicker(ctx, kids.children, child, c => { const u = new URL(location.href); u.searchParams.set('child', c.studentId); history.replaceState(null, '', u); draw(c); }),
      mocksHost, h('div', {class: 'flex flex-col gap-4'}, modulesHost, trendsHost, statsHost, vocabHost, courseHost));
    for (const region of Object.keys(kinds)) { kinds[region].host.replaceChildren(loadingNode(dict, region)); void load(region); }
  };
  if (!kids.selected) { page.replaceChildren(emptyState(ctx)); return; }
  draw(kids.selected);
}
