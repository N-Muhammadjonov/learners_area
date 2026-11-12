import {h} from '../../js/native.js';
import {api, loadStyles, tr, marker, failureText, loadChildren, childPicker, emptyState, replaceOptionalChildren} from './shared.js';

/** Guardian Leaderboard: public aliases, ranks and points only. Rows are plain text, never links. */
export async function mount(ctx) {
  loadStyles();
  const {root, signal, dict} = ctx;
  const page = h('div', {class: 'pc-page', 'data-route-usable': 'guardian-leaderboard'});
  root.append(page);
  page.append(h('p', {role: 'status'}, dict.common.loading));
  let kids;
  try { kids = await loadChildren(ctx); } catch (error) {
    if (signal.aborted) return;
    page.replaceChildren(h('div', {class: 'pc-card', role: 'alert'}, failureText(ctx, error)));
    return;
  }
  if (signal.aborted) return;
  if (!kids.selected) { page.replaceChildren(emptyState(ctx)); return; }
  let child = kids.selected, period = 'week', ticket = 0;
  const list = h('div', {class: 'pc-card', style: {padding: 0}});
  const periods = [['week', tr(ctx, 'Hafta', 'Week')], ['month', tr(ctx, 'Oy', 'Month')], ['all', tr(ctx, 'Hammasi', 'All time')]];
  const bar = h('div', {class: 'pc-chips', role: 'group'});
  const paintBar = () => bar.replaceChildren(...periods.map(([key, label]) =>
    h('button', {type: 'button', class: 'pc-chip', 'aria-pressed': String(key === period), onClick: () => { period = key; paintBar(); void load(); }}, label)));
  const medal = rank => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank);
  async function load() {
    const mine = ++ticket;
    list.replaceChildren(h('p', {role: 'status', style: {padding: '1rem'}}, dict.common.loading));
    try {
      const data = await api(`/api/guardian/children/${encodeURIComponent(child.studentId)}/leaderboard?period=${period}`, {signal});
      if (signal.aborted || mine !== ticket) return;
      const rows = data.standings.map(s => h('div', {class: 'pc-rank', 'data-mine': String(s.mine)},
        h('b', {}, medal(s.rank)), h('span', {}, s.mine ? `${s.alias} · ${tr(ctx, 'farzandingiz', 'your child')}` : s.alias),
        h('b', {}, String(s.stars))));
      replaceOptionalChildren(list, ...(rows.length ? rows : [h('p', {style: {padding: '1rem'}, class: 'pc-muted'}, tr(ctx, 'Reytingda hali ishtirokchi yo‘q.', 'No participants yet.'))]),
        data.position === null ? h('p', {class: 'pc-note', style: {margin: '.75rem'}}, tr(ctx, 'Farzandingiz bu davrda reytingda ishtirok etmayapti.', 'Your child is not on the leaderboard for this period.')) : null);
    } catch (error) {
      if (signal.aborted || mine !== ticket) return;
      list.replaceChildren(h('div', {role: 'alert', style: {padding: '1rem'}}, failureText(ctx, error),
        h('button', {type: 'button', class: 'btn-secondary', onClick: () => void load()}, dict.errorPage.retry)));
    }
  }
  paintBar();
  replaceOptionalChildren(page,
    h('div', {class: 'flex flex-wrap items-center justify-between gap-2'},
      h('div', {}, h('h1', {class: 'font-display text-2xl text-ink-900'}, dict.nav.leaderboard ?? tr(ctx, 'Reyting', 'Leaderboard')),
        h('p', {class: 'pc-muted'}, tr(ctx, 'Ommaviy reyting: boshqa o‘quvchilarning shaxsiy ma’lumoti ko‘rinmaydi', 'Public ranking only; other students’ private details are never shown'))), marker(ctx)),
    childPicker(ctx, kids.children, child, c => { child = c; const u = new URL(location.href); u.searchParams.set('child', c.studentId); history.replaceState(null, '', u); void load(); }),
    bar, list);
  void load();
}
