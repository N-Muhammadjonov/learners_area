import {h} from '../../js/native.js';
import {bandAxis} from '../shared/band-axis.js';
import {failureNode} from './shared.js';

const LABELS = {
  en: {
    completed: 'First attempts scored', accuracy: 'Average accuracy', average: 'Average band',
    latest: 'Latest band', best: 'Best band', change: 'First → latest', noAttempts: 'No scored attempts yet.',
    fullTests: 'Each passage or test counts once. Band estimates use 40-question tests.', table: 'Show attempts as a table',
    date: 'Date', band: 'Band', trend: 'Band trend',
  },
  uz: {
    completed: 'Baholangan birinchi urinishlar', accuracy: 'O‘rtacha foiz', average: 'O‘rtacha band',
    latest: 'So‘nggi band', best: 'Eng yaxshi band', change: 'Birinchi → so‘nggi', noAttempts: 'Hali baholangan urinish yo‘q.',
    fullTests: 'Har bir passage yoki test bir marta hisoblanadi. Band 40 savollik testlardan olinadi.', table: 'Urinishlarni jadvalda ko‘rish',
    date: 'Sana', band: 'Band', trend: 'Band o‘zgarishi',
  },
};

function bandChart(recent, name, labels, format) {
  const axis = bandAxis(recent.map(point => point.band), {top: 18, bottom: 118});
  const x = index => recent.length === 1 ? 235 : 44 + index * 385 / (recent.length - 1);
  return [
    h('svg', {viewBox: '0 0 450 135', class: 'block w-full', role: 'img', 'aria-label': name + ' · ' + labels.trend},
      axis.ticks.map(value => h('g', {'data-band-tick': value.toFixed(1)},
        h('line', {x1: 44, x2: 429, y1: axis.y(value), y2: axis.y(value), stroke: 'currentColor', opacity: '.3'}),
        h('text', {x: 5, y: axis.y(value) + 4, fill: 'currentColor', fontSize: 11}, format(value)))),
      recent.length > 1 ? h('polyline', {
        points: recent.map((point, index) => `${x(index)},${axis.y(point.band)}`).join(' '),
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
      }) : null,
      recent.map((point, index) => h('g', {'data-attempt-band-point': point.band},
        h('title', {}, `${point.day} · ${format(point.band)}`),
        h('circle', {cx: x(index), cy: axis.y(point.band), r: 4, fill: 'rgb(var(--gold))'}),
        axis.below(point.band) ? h('text', {x: x(index), y: 133, textAnchor: 'middle', fill: 'currentColor', fontSize: 11}, '↓') : null))),
    h('details', {},
      h('summary', {class: 'meta-text cursor-pointer'}, labels.table),
      h('table', {class: 'mt-2 w-full text-left text-sm', 'data-attempt-band-table': ''},
        h('caption', {class: 'sr-only'}, name + ' · ' + labels.trend),
        h('thead', {}, h('tr', {}, h('th', {scope: 'col'}, labels.date), h('th', {scope: 'col'}, labels.band))),
        h('tbody', {}, recent.map(point => h('tr', {},
          h('th', {scope: 'row', class: 'font-normal'}, point.day),
          h('td', {}, format(point.band))))))),
  ];
}

export function attemptBandCards(bands, dict, locale, refresh) {
  const labels = LABELS[locale] ?? LABELS.en;
  const bandNumber = new Intl.NumberFormat(locale, {minimumFractionDigits: 1, maximumFractionDigits: 2});
  const deltaNumber = new Intl.NumberFormat(locale, {minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
  const percent = new Intl.NumberFormat(locale, {style: 'percent', maximumFractionDigits: 1});
  const format = value => value === null ? '—' : bandNumber.format(value);
  return h('div', {class: 'grid gap-4 lg:grid-cols-2', 'data-progress-attempt-bands': ''}, ['reading', 'listening'].map(skill => {
    const summary = bands[skill];
    const name = dict.nav[skill];
    return h('section', {class: 'card min-w-0 space-y-3 p-4', 'data-attempt-band-panel': skill},
      h('h2', {class: 'font-display text-xl font-bold'}, name),
      summary === null ? failureNode({region: `progress-${skill}-bands`, message: dict.errors.unknown, retry: dict.errorPage.retry, refresh}) : [
        h('dl', {class: 'grid grid-cols-2 gap-2 sm:grid-cols-3'}, [
          ['completed', labels.completed, String(summary.completed)],
          ['accuracy', labels.accuracy, summary.accuracy === null ? '—' : percent.format(summary.accuracy / 100)],
          ['average', labels.average, format(summary.averageBand)],
          ['latest', labels.latest, format(summary.recent.at(-1)?.band ?? null)],
          ['best', labels.best, format(summary.bestBand)],
          ['change', labels.change, summary.bandCount < 2 || summary.firstBand === null || !summary.recent.length ? '—'
            : deltaNumber.format(summary.recent.at(-1).band - summary.firstBand)],
        ].map(([key, label, value]) => h('div', {class: 'rounded-xl border border-ink-100 p-2'},
          h('dt', {class: 'text-xs font-semibold'}, label),
          h('dd', {class: 'text-xl font-bold', 'data-attempt-band-stat': key}, value)))),
        h('p', {class: 'meta-text'}, summary.completed ? labels.fullTests : labels.noAttempts),
        summary.recent.length ? bandChart(summary.recent, name, labels, format) : null,
      ]);
  }));
}
