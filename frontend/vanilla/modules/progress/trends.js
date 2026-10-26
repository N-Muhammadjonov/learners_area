import {h} from '../../js/native.js';
import {Card} from '../../js/generated/ui.js';

/** Port of the original heatLevel: 0 / 1 / 2–3 / 4–5 / 6+. */
export function heatLevel(count) {
  return count <= 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
}
const HEAT_ALPHA = [0.08, 0.3, 0.5, 0.75, 1];

function weekChart(t, title, points, max, unit, id) {
  if (points === null) {
    return h('div', {'data-trend': id, 'data-trend-unavailable': ''},
      h('h3', {class: 'text-sm font-medium text-ink-900'}, title),
      h('p', {class: 'meta-text'}, t.unavailable));
  }
  const any = points.some(p => p.value !== null);
  return h('div', {class: 'flex flex-col gap-2', 'data-trend': id},
    h('h3', {class: 'text-sm font-medium text-ink-900'}, title),
    !any ? h('p', {class: 'meta-text', 'data-trend-empty': ''}, t.noData)
      : h('div', {class: 'flex h-24 items-end gap-1', 'aria-hidden': 'true'}, points.map(p => h('div', {
        key: p.weekStart, class: 'flex flex-1 flex-col items-center justify-end gap-1',
      },
        h('span', {class: 'technical-text text-[10px] text-ink-500'}, p.value ?? ''),
        h('span', {
          class: 'w-full rounded-t bg-gold/70',
          style: {height: p.value === null ? '0px' : `${Math.max(4, (p.value / max) * 64)}px`},
        })))),
    h('details', {},
      h('summary', {class: 'meta-text cursor-pointer'}, t.asTable),
      h('div', {class: 'overflow-x-auto'},
        h('table', {class: 'mt-2 w-full text-left text-xs', 'data-trend-table': id},
          h('caption', {class: 'sr-only'}, title),
          h('thead', {}, h('tr', {},
            h('th', {scope: 'col'}, t.week), h('th', {scope: 'col'}, t.value), h('th', {scope: 'col'}, t.count))),
          h('tbody', {}, points.map(p => h('tr', {},
            h('th', {scope: 'row', class: 'font-normal'}, p.weekStart),
            h('td', {}, p.value === null ? '—' : `${p.value}${unit}`),
            h('td', {}, String(p.count)))))))));
}

function heatmapCard(t, heatmap) {
  const days = heatmap?.flat() ?? [];
  return h(Card, {'data-progress-heatmap': ''},
    h('h2', {class: 'mb-1 font-display text-lg text-ink-900'}, t.heatmapTitle),
    h('p', {class: 'meta-text mb-3'}, t.heatmapHint),
    heatmap === null ? h('p', {class: 'meta-text', 'data-trend-unavailable': ''}, t.unavailable) : [
      h('div', {class: 'flex gap-1', 'aria-hidden': 'true'}, heatmap.map(week => h('div', {class: 'flex flex-col gap-1'},
        week.map(d => h('span', {
          title: `${d.day}: ${d.count}`, 'data-heat': heatLevel(d.count),
          class: 'block h-3 w-3 rounded-sm',
          style: {background: `rgb(var(--gold) / ${HEAT_ALPHA[heatLevel(d.count)]})`},
        }))))),
      h('details', {},
        h('summary', {class: 'meta-text cursor-pointer'}, t.asTable),
        h('div', {class: 'overflow-x-auto'},
          h('table', {class: 'mt-2 text-left text-xs', 'data-heatmap-table': ''},
            h('caption', {class: 'sr-only'}, t.heatmapTitle),
            h('thead', {}, h('tr', {}, h('th', {scope: 'col'}, t.day), h('th', {scope: 'col'}, t.activities))),
            h('tbody', {}, days.filter(d => d.count > 0).map(d => h('tr', {},
              h('th', {scope: 'row', class: 'font-normal'}, d.day),
              h('td', {}, String(d.count))))))))],
  );
}

function retentionRow(r) {
  const change = r.change === null ? '—' : r.change > 0 ? `+${r.change}` : String(r.change);
  const cells = [
    h('th', {scope: 'row'}, r.level),
    h('td', {}, String(r.attempts)),
    h('td', {}, String(r.textsCompleted)),
    h('td', {}, r.best === null ? '—' : String(r.best)),
    h('td', {class: 'technical-text'}, r.recent.length ? r.recent.join(' → ') : '—'),
    h('td', {}, r.average === null ? '—' : String(r.average)),
    h('td', {}, change),
  ];
  return h('tr', {'data-retention-trend-level': r.level}, ...cells);
}

function retentionCard(t, retention) {
  const headers = [t.level, t.attempts, t.textsCompleted, t.best, t.recent, t.average, t.change]
    .map(label => h('th', {scope: 'col'}, label));
  const table = h('table', {class: 'w-full text-left text-sm', 'data-retention-trend-table': ''},
    h('caption', {class: 'sr-only'}, t.retentionTitle),
    h('thead', {}, h('tr', {}, ...headers)),
    h('tbody', {}, (retention??[]).map(retentionRow)));
  const body = retention === null
    ? h('p', {class: 'meta-text', 'data-trend-unavailable': ''}, t.unavailable)
    : h('div', {class: 'overflow-x-auto'}, table);
  return h(Card, {'data-progress-retention-trends': ''},
    h('h2', {class: 'mb-2 font-display text-lg text-ink-900'}, t.retentionTitle),
    body);
}

/** Trends, heatmap and retention. Each series is independently null (unavailable), never zero. */
export function trendCards(trends, dict) {
  const t = dict.progress.trends;
  return h('div', {class: 'flex flex-col gap-4'},
    h(Card, {'data-progress-trends': ''},
      h('h2', {class: 'mb-1 font-display text-lg text-ink-900'}, t.title),
      h('p', {class: 'meta-text mb-3'}, t.hint),
      h('div', {class: 'grid gap-4 sm:grid-cols-2'},
        weekChart(t, t.readingAccuracy, trends.reading, 100, '%', 'reading'),
        weekChart(t, t.listeningAccuracy, trends.listening, 100, '%', 'listening'),
        weekChart(t, t.writingBand, trends.writing, 9, '', 'writing'),
        weekChart(t, t.speakingBand, trends.speaking, 9, '', 'speaking'))),
    heatmapCard(t, trends.heatmap),
    retentionCard(t, trends.retention));
}
