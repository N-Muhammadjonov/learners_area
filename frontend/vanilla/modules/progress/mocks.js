import {h} from '../../js/native.js';
import {summarizeMocks} from './mock-summary.js';
import {bandAxis} from '../shared/band-axis.js';

/** Port of MockProgressOverview + MockBandPanel (non-dashboard). Presentation only: estimates are
 * server-stored; the summary is arithmetic over them. Trend is FULL mocks only. */
export function mockOverview(dto, uz, catalogueFailure) {
  const summary = summarizeMocks(dto.attempts, dto.tests.filter(t => t.skill === 'full').map(t => t.id));
  return h('div', {class: 'space-y-3', 'data-mock-overview': ''},
    dto.catalogueUnavailable ? catalogueFailure : null,
    bandPanel(summary, uz));
}

const show = n => (n === null ? '—' : n.toFixed(1));

function bandPanel(summary, uz) {
  const points = summary.points.slice(-12);
  const x = i => (points.length < 2 ? 330 : 45 + (i * 565) / (points.length - 1));
  const axis=bandAxis(points.map(p=>p.estimatedBand),{top:30,bottom:215}),y=axis.y;
  const tiles = [
    [uz ? 'Tugallangan urinishlar' : 'Completed attempts', String(summary.attempts)],
    [uz ? "So'nggi band" : 'Latest band', show(summary.latest)],
    [uz ? 'Eng yaxshi band' : 'Best band', show(summary.best)],
    [uz ? "O'rtacha band" : 'Average band', show(summary.average)],
    [uz ? "Birinchi → so'nggi" : 'First → latest',
      summary.change === null ? '—' : `${summary.change >= 0 ? '+' : ''}${show(summary.change)}`],
  ];
  return h('section', {
    class: 'card min-w-0 p-5 space-y-5',
    'data-mock-band-panel': '',
    'data-latest-band': summary.latest === null ? 'none' : summary.latest.toFixed(1),
    'data-completed-mocks': String(summary.completed),
    'data-total-mocks': String(summary.total),
  },
  h('h2', {class: 'font-display text-xl font-bold'}, `📈 ${uz ? 'Mock natijalari' : 'Overall mock band trend'}`),
  h('div', {class: 'grid grid-cols-2 gap-3 sm:grid-cols-5'}, tiles.map(([label, value]) =>
    h('div', {class: 'rounded-xl border border-ink-100 p-3'},
      h('p', {class: 'text-xs font-semibold'}, label),
      h('p', {class: 'text-2xl font-bold', 'data-mock-stat': label}, value)))),
  h('label', {class: 'block'},
    uz ? 'Katalogdagi tugallangan mocklar' : 'Completed catalogue mocks', ' · ',
    `${summary.completed} / ${summary.total}`,
    h('progress', {class: 'mock-progress-track', value: summary.completed, max: Math.max(1, summary.total)})),
  h('label', {class: 'block'},
    uz ? "So'nggi band / 9.0" : 'Latest band / 9.0', ' · ', show(summary.latest),
    h('progress', {class: 'mock-progress-track', value: summary.latest ?? 0, max: 9})),
  h('svg', {
    viewBox: '0 0 660 265', class: 'w-full', role: 'img',
    'aria-label': uz ? 'Haqiqiy tugallangan full mock bandlari' : 'Completed full mock band estimates',
  },
  axis.ticks.map(n => h('g', {'data-band-tick':n.toFixed(1)},
    h('line', {x1: 45, x2: 610, y1: y(n), y2: y(n), stroke: 'currentColor', opacity: '.15'}),
    h('text', {x: 10, y: y(n) + 4, fill: 'currentColor', fontSize: 12}, n.toFixed(1)))),
  points.length > 1 ? h('polyline', {
    points: points.map((a, i) => `${x(i)},${y(a.estimatedBand)}`).join(' '),
    fill: 'none', stroke: 'currentColor', strokeWidth: 3,
  }) : null,
  points.map((a, i) => h('g', {'data-mock-point': a.id},
    h('circle', {cx: x(i), cy: y(a.estimatedBand), r: 5, fill: 'rgb(var(--gold))', stroke: 'currentColor', strokeWidth: 2}),
    h('text', {x: x(i), y: y(a.estimatedBand) - 12, textAnchor: 'middle', fill: 'currentColor', fontSize: 13}, show(a.estimatedBand)),
    h('text', {x: x(i), y: 245, textAnchor: 'middle', fill: 'currentColor', fontSize: 10},
      a.finishedAt.toLocaleDateString(uz ? 'uz-UZ' : 'en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'})))),
  ),
  !points.length ? h('p', {}, uz ? "Hali baholangan full mock natijasi yo'q." : 'No graded full mock results yet.') : null,
  points.length ? h('details', {},
    h('summary', {}, uz ? "Jadvalni ko'rsatish" : 'Show as table'),
    h('div', {class: 'overflow-x-auto'},
      h('table', {class: 'w-full text-sm', 'data-mock-table': ''},
        h('caption', {class: 'sr-only'}, uz ? 'Mock natijalari' : 'Mock results'),
        h('thead', {}, h('tr', {},
          h('th', {scope: 'col'}, 'Mock'),
          h('th', {scope: 'col'}, uz ? 'Sana' : 'Date'),
          h('th', {scope: 'col'}, 'Band'))),
        h('tbody', {}, points.map(a => h('tr', {},
          h('td', {}, a.title ?? 'Mock'),
          h('td', {}, a.finishedAt.toISOString().slice(0, 10)),
          h('td', {}, show(a.estimatedBand)))))))) : null);
}
