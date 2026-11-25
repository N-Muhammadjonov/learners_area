import {h} from '../../js/native.js';
import {bandAxis} from '../shared/band-axis.js';
import {failureNode} from './shared.js';

const SKILLS = ['reading', 'listening'];
const LABELS = {
  en: {
    completed: 'First attempts scored', accuracy: 'Average accuracy', average: 'Average band',
    latest: 'Latest band', best: 'Best band', change: 'First → latest', noAttempts: 'No scored attempts yet.',
    fullTests: 'Each passage or test counts once. Band estimates use 40-question tests.',
    scale: 'Band scale', trend: 'Weekly average band', table: 'Show weekly averages as a table',
    noBands: 'Weekly band averages appear after a scored 40-question test.',
    practice: 'General Reading practice', checked: 'Checked passages', week: 'Week starting',
  },
  uz: {
    completed: 'Baholangan birinchi urinishlar', accuracy: 'O‘rtacha foiz', average: 'O‘rtacha band',
    latest: 'So‘nggi band', best: 'Eng yaxshi band', change: 'Birinchi → so‘nggi', noAttempts: 'Hali baholangan urinish yo‘q.',
    fullTests: 'Har bir matn yoki test bir marta hisoblanadi. Band 40 savollik testlardan olinadi.',
    scale: 'Band shkalasi', trend: 'Haftalik o‘rtacha band', table: 'Haftalik o‘rtachalarni jadvalda ko‘rish',
    noBands: 'Haftalik o‘rtacha band 40 savollik test baholangach ko‘rinadi.',
    practice: 'General Reading mashqlari', checked: 'Tekshirilgan matnlar', week: 'Hafta boshi',
  },
};

function bandChart(bands, names, labels, format) {
  const series = Object.fromEntries(SKILLS.map(skill =>
    [skill, new Map((bands[skill]?.weeklyBand ?? []).map(point => [point.weekStart, point.value]))]));
  const weeks = [...new Set(SKILLS.flatMap(skill => [...series[skill].keys()]))].sort();
  const formatDate = day => day.slice(5).replace('-', '/');
  const axis = bandAxis([], {top: 25, bottom: 200});
  const x = index => weeks.length < 2 ? 330 : 55 + index * 550 / (weeks.length - 1);
  const hasPoints = SKILLS.some(skill => [...series[skill].values()].some(value => value !== null));
  return [
    h('svg', {viewBox: '0 0 660 246', class: 'block w-full max-w-4xl mx-auto', role: 'img',
      'aria-label': labels.trend + ' · 4.0–9.0', 'data-band-scale': '4.0-9.0'},
      axis.ticks.map(value => h('g', {'data-band-tick': value.toFixed(1)},
        h('line', {x1: 55, x2: 605, y1: axis.y(value), y2: axis.y(value), stroke: 'currentColor',
          strokeWidth: 1.25, opacity: '.45', 'data-band-gridline': value.toFixed(1)}),
        h('text', {x: 8, y: axis.y(value) + 6, fill: 'currentColor', fontSize: 20}, format(value)))),
      hasPoints ? weeks.map((week, index) => h('text', {x: x(index), y: 242, textAnchor: 'middle',
        fill: 'currentColor', fontSize: 17}, formatDate(week))) : null,
      SKILLS.map(skill => {
        const gold = skill === 'reading';
        const color = gold ? 'rgb(var(--gold))' : 'currentColor';
        const points = weeks.flatMap((week, index) => {
          const value = series[skill].get(week);
          return value == null ? [] : [{week, value, x: x(index), y: axis.y(value)}];
        });
        return h('g', {'data-weekly-band-series': skill},
          points.length > 1 ? h('polyline', {points: points.map(p => `${p.x},${p.y}`).join(' '),
            fill: 'none', stroke: color, strokeWidth: 3, strokeDasharray: gold ? null : '8 5'}) : null,
          points.map(p => h('g', {'data-weekly-band-point': p.value},
            h('title', {}, `${names[skill]} · ${p.week} · ${format(p.value)}`),
            gold ? h('circle', {cx: p.x, cy: p.y, r: 5, fill: color})
              : h('rect', {x: p.x - 4, y: p.y - 4, width: 8, height: 8, fill: color}),
            h('text', {x: p.x, y: p.y + (gold ? -10 : 20), textAnchor: 'middle', fill: color, fontSize: 17},
              (axis.below(p.value) ? '↓ ' : '') + format(p.value)))));
      })),
    hasPoints ? h('details', {},
      h('summary', {class: 'meta-text cursor-pointer'}, labels.table),
      h('table', {class: 'mt-2 w-full text-left text-sm', 'data-attempt-band-table': ''},
        h('caption', {class: 'sr-only'}, labels.trend),
        h('thead', {}, h('tr', {}, h('th', {scope: 'col'}, labels.week),
          SKILLS.map(skill => h('th', {scope: 'col'}, names[skill])))),
        h('tbody', {}, weeks.map(week => h('tr', {},
          h('th', {scope: 'row', class: 'font-normal'}, week),
          SKILLS.map(skill => h('td', {}, format(series[skill].get(week) ?? null))))))))
      : h('p', {class: 'meta-text'}, labels.noBands),
  ];
}

export function attemptBandCards(bands, practice, dict, locale, refresh) {
  const labels = LABELS[locale] ?? LABELS.en;
  const names = {reading: dict.nav.reading, listening: dict.nav.listening};
  const bandNumber = new Intl.NumberFormat(locale, {minimumFractionDigits: 1, maximumFractionDigits: 2});
  const deltaNumber = new Intl.NumberFormat(locale, {minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: 'exceptZero'});
  const percent = new Intl.NumberFormat(locale, {style: 'percent', maximumFractionDigits: 1});
  const format = value => value === null ? '—' : bandNumber.format(value);
  const formatAccuracy = value => value === null ? '—' : percent.format(value / 100);
  const axis = bandAxis([]);
  return h('section', {class: 'card min-w-0 space-y-5 p-5', 'data-progress-attempt-bands': ''},
    h('h2', {class: 'font-display text-xl font-bold'}, labels.trend, ' · ',
      h('span', {class: 'whitespace-nowrap'}, '4.0–9.0')),
    bandChart(bands, names, labels, format),
    h('div', {class: 'grid gap-5 lg:grid-cols-2'}, SKILLS.map(skill => {
      const summary = bands[skill];
      const average = summary?.averageBand ?? null;
      const latest = summary?.recent.at(-1)?.band ?? null;
      const meterLabel = `${names[skill]} · ${labels.average} · ${labels.scale} 4.0–9.0`;
      return h('section', {class: 'min-w-0 space-y-3', 'data-attempt-band-panel': skill},
        h('h3', {class: 'font-display text-lg font-bold'},
          h('span', {class: skill === 'reading' ? 'text-gold' : null, 'aria-hidden': 'true'}, skill === 'reading' ? '● ' : '■ '),
          names[skill]),
        summary === null ? failureNode({region: `progress-${skill}-bands`, message: dict.errors.unknown, retry: dict.errorPage.retry, refresh}) : [
          h('dl', {class: 'grid grid-cols-2 gap-2 sm:grid-cols-3'}, [
            ['completed', labels.completed, String(summary.completed)],
            ['accuracy', labels.accuracy, formatAccuracy(summary.accuracy)],
            ['latest', labels.latest, format(latest)],
            ['best', labels.best, format(summary.bestBand)],
            ['change', labels.change, summary.bandCount < 2 || summary.firstBand === null || latest === null ? '—'
              : deltaNumber.format(latest - summary.firstBand)],
          ].map(([key, label, value]) => h('div', {class: 'rounded-xl border border-ink-100 p-2'},
            h('dt', {class: 'text-xs font-semibold'}, label),
            h('dd', {class: 'text-xl font-bold', 'data-attempt-band-stat': key}, value)))),
          h('div', {class: 'text-sm'},
            labels.average, ' · ', h('strong', {'data-attempt-band-stat': 'average'}, format(average)),
            axis.below(average) ? h('span', {'aria-hidden': 'true'}, ' ↓') : null,
            h('progress', {class: 'mock-progress-track', value: Math.max(0, (average ?? axis.min) - axis.min),
              max: axis.max - axis.min, 'aria-label': meterLabel, 'aria-valuetext': average === null ? null : format(average),
              style: {accentColor: skill === 'reading' ? 'rgb(var(--gold))' : 'currentColor'},
              'aria-hidden': average === null ? true : null, 'data-band-scale': '4.0-9.0'})),
          h('p', {class: 'meta-text'}, summary.completed ? labels.fullTests : labels.noAttempts),
        ],
        skill === 'reading' && practice !== null ? h('div', {class: 'text-sm', 'data-general-reading-practice': ''},
          h('h4', {class: 'font-semibold'}, labels.practice),
          h('p', {class: 'meta-text'}, labels.checked, ' · ', practice.completed, ' · ',
            labels.accuracy, ' · ', formatAccuracy(practice.accuracy))) : null);
    })));
}
