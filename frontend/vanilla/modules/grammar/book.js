
import {h} from '../../js/native.js';
import {bookIndex} from './book-index.js';
import {renderInteractiveBook} from './book-runtime.js';

const LEVELS = ['B1', 'B2', 'C1', 'C2'];
const GROUP = code => ['A0', 'A1', 'A2', 'B1'].includes(code) ? 'B1' : code;
const LOADERS = {
  B1: () => import('./book-content-b1.js'),
  B2: () => import('./book-content-b2.js'),
  C1: () => import('./book-content-c1.js'),
  C2: () => import('./book-content-c2.js'),
};
const LANG = {
  uz: {
    search: '🔍 Qidiruv', group: 'Grammar darajalari', title: 'Grammar with Learners Area',
    subtitle: 'Darajalarga ajratilgan grammatika va to‘rt bosqichli mashqlar',
    stages: '4 bosqich', blocks: 'mashq bloki', topics: 'mavzu',
    start: 'Boshlash', resume: 'Davom etish', finished: 'Tugallangan',
    empty: 'Bu qidiruvga mos grammar mavzusi topilmadi.', back: 'Grammar Lessons',
    loading: 'Mashqlar yuklanmoqda…', error: 'Mashqlarni yuklashda xato.', retry: 'Qayta urinish',
  },
  en: {
    search: '🔍 Search', group: 'Grammar levels', title: 'Grammar with Learners Area',
    subtitle: 'Level-based grammar with four-stage practice',
    stages: '4 stages', blocks: 'practice blocks', topics: 'topics',
    start: 'Start', resume: 'Continue', finished: 'Completed',
    empty: 'No grammar topics match the search.', back: 'Grammar Lessons',
    loading: 'Loading exercises…', error: 'Could not load exercises.', retry: 'Try again',
  },
};
const translation = ctx => LANG[ctx.locale === 'en' ? 'en' : 'uz'];
const keyOf = ctx => 'la:grammar:interactive:v1:' + (ctx.session?.user?.id || 'anonymous');

function ensureStyle() {
  if (document.querySelector('[data-grammar-book-style]')) return;
  document.head.append(h('link', {
    rel: 'stylesheet', href: '/modules/grammar/book.css', 'data-grammar-book-style': '',
  }));
}
function stored(ctx) {
  try {
    const record = JSON.parse(localStorage.getItem(keyOf(ctx)) || '{}');
    return record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  } catch { return {}; }
}
function completion(unit, progress) {
  const recorded = progress[unit.id] || {};
  let done = 0, total = 0;
  unit.stageWeights.forEach((weights, si) => {
    const completed = recorded[si] || {};
    weights.forEach((_, ei) => {
      total++;
      if (Object.prototype.hasOwnProperty.call(completed, ei)) done++;
    });
  });
  return {done, total};
}
function card(unit, progress, t) {
  const status = completion(unit, progress);
  const action = status.done === status.total ? t.finished : status.done ? t.resume : t.start;
  return h('article', {
    class: 'grammar-book-card', 'data-grammar-book-unit': unit.id,
  }, h('div', {class: 'grammar-book-card-top'},
      h('span', {class: 'grammar-book-code'}, unit.code + ' · ' + unit.lessons),
      h('span', {class: 'grammar-book-stage'}, t.stages)),
    h('h2', {class: 'grammar-book-card-title'}, unit.title),
    h('p', {class: 'grammar-book-card-summary'}, unit.summary),
    h('div', {class: 'grammar-book-card-bottom'},
      h('span', {class: 'grammar-book-progress'}, status.done + '/' + status.total + ' ' + t.blocks),
      h('a', {class: 'grammar-book-card-link',
        href: '/app/grammar/lessons?book=' + encodeURIComponent(unit.id),
        'data-grammar-book-open': unit.id}, action)));
}
export function mountBookCatalog(ctx, host) {
  ensureStyle();
  const t = translation(ctx), saved = stored(ctx);
  const search = h('input', {
    type: 'search', class: 'grammar-book-search',
    placeholder: t.search, 'aria-label': t.search, 'data-grammar-book-search': '',
  });
  const buttons = LEVELS.map(level => h('button', {
    type: 'button', class: 'grammar-book-level',
    'data-grammar-book-level': level, 'aria-pressed': String(level === 'B1'),
  }, level));
  const entries = bookIndex.map(unit => ({unit, node: card(unit, saved, t)}));
  const grid = h('div', {class: 'grammar-book-grid', 'data-grammar-book-grid': ''}, entries.map(x => x.node));
  const count = h('p', {class: 'grammar-book-count', role: 'status'});
  const empty = h('p', {class: 'grammar-book-empty', hidden: true}, t.empty);
  let selected = 'B1';
  const refresh = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const {unit, node} of entries) {
      const found = GROUP(unit.code) === selected
        && (unit.title + ' ' + unit.summary + ' ' + unit.code).toLocaleLowerCase().includes(query);
      node.hidden = !found;
      if (found) visible++;
    }
    count.textContent = visible + ' ' + t.topics;
    empty.hidden = visible !== 0;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.grammarBookLevel === selected));
    }
  };
  search.addEventListener('input', refresh, {signal: ctx.signal});
  for (const button of buttons) {
    button.addEventListener('click', () => {
      selected = button.dataset.grammarBookLevel;
      refresh();
    }, {signal: ctx.signal});
  }
  host.append(h('section', {
    class: 'grammar-book-catalog', 'data-grammar-book-catalog': '',
  }, h('header', {class: 'grammar-book-heading'},
      h('h1', {}, t.title), h('p', {}, t.subtitle)),
    h('div', {class: 'grammar-book-controls'}, search,
      h('div', {class: 'grammar-book-level-group', role: 'group', 'aria-label': t.group}, buttons)),
    count, grid, empty));
  refresh();
}
export async function mountBookDetail(ctx, host, id) {
  ensureStyle();
  const t = translation(ctx), meta = bookIndex.find(unit => unit.id === id);
  if (!meta) {
    host.replaceChildren(h('a', {href: '/app/grammar/lessons'}, '← ' + t.back),
      h('p', {}, t.empty));
    return;
  }
  const progress = h('p', {role: 'status', class: 'grammar-book-count'}, t.loading);
  const retry = h('button', {type: 'button', hidden: true, class: 'btn-secondary'}, t.retry);
  const exercise = h('div', {class: 'grammar-book-exercise-host', 'data-grammar-book-exercise': id});
  host.replaceChildren(h('section', {
    class: 'grammar-book-detail', 'data-route-usable': 'grammar-book-detail',
    'data-grammar-book-detail': id,
  }, h('a', {href: '/app/grammar/lessons', class: 'grammar-book-back'}, '← ' + t.back),
    h('span', {class: 'grammar-book-code'}, meta.code + ' · ' + meta.lessons),
    h('h1', {class: 'grammar-book-detail-title'}, meta.title),
    h('p', {class: 'grammar-book-detail-summary'}, meta.summary),
    progress, retry, exercise));
  const load = async () => {
    if (ctx.signal.aborted) return;
    progress.hidden = false;
    progress.textContent = t.loading;
    retry.hidden = true;
    try {
      const result = await LOADERS[GROUP(meta.code)]();
      if (ctx.signal.aborted) return;
      const unit = result.default.find(row => row.id === id);
      if (!unit) throw Error('Unknown grammar book unit');
      const shadow = exercise.shadowRoot || exercise.attachShadow({mode: 'open'});
      shadow.replaceChildren();
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/modules/grammar/book-runtime.css';
      const body = document.createElement('div');
      body.className = 'grammar-book';
      body.innerHTML = '<nav id="nav" hidden></nav><div id="units"></div>';
      shadow.append(css, body);
      renderInteractiveBook(shadow, [unit], ctx.signal, keyOf(ctx));
      progress.hidden = true;
    } catch {
      if (ctx.signal.aborted) return;
      progress.textContent = t.error;
      retry.hidden = false;
    }
  };
  retry.addEventListener('click', load, {signal: ctx.signal});
  await load();
}
