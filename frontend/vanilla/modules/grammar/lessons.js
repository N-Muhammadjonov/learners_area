import {h} from '../../js/native.js';
import {viewData} from '../../js/adapters/frontend.js';
import {lessonsCatalogueDTO} from '../../js/adapters/listening-lessons-v10.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {mountBookCatalog} from './book.js';
import {grammarPracticeHref} from './practice-route.js';

/** Grammar lessons catalogue `/app/grammar/lessons?page=N` (the original GrammarLibraryResults). */
export function mount(context) {
  const {root, url, signal, dict} = context;
  const host = h('div', {'data-grammar-lessons-host': ''});
  root.append(host);
  const bookId = url.searchParams.get('book');
  if (bookId !== null) {
    const destination=grammarPracticeHref(url.pathname+url.search);
    if(destination!==url.pathname+url.search) void context.navigate(destination,{replace:true});
    else host.replaceChildren(h('p',{role:'alert'},
      context.locale==='en'?'Grammar lesson not found.':'Grammar darsi topilmadi.'));
    return;
  }
  const catalogHost = h('div');
  const legacyHost = h('div');
  const legacySection = h('section', {class: 'grammar-book-existing'},
    h('h2', {}, context.locale === 'en' ? 'Other grammar lessons' : 'Boshqa grammar darslari'),
    legacyHost);
  host.append(catalogHost, legacySection);
  mountBookCatalog(context, catalogHost);
  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1));
  let generation = 0;

  function loading() {
    return h('div', {
      role: 'status', 'aria-busy': 'true', 'aria-label': dict.common.loading,
      class: 'h-32 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': 'grammar-lessons-library',
    });
  }

  function pageHref(n) {
    return `${url.pathname}?page=${n}`;
  }

  function render(p) {
    const cards = p.library.rows.map(lesson => h('article', {class: 'card p-5', 'data-grammar-lesson': lesson.id},
      h('h2', {class: 'card-title'}, lesson.title),
      lesson.summary ? h('p', {class: 'body-text'}, lesson.summary) : null,
      h('a', {class: 'btn-primary', href: `/app/grammar/lessons/${lesson.id}`}, dict.listening.hub.open)));
    return h('div', {class: 'mx-auto flex max-w-5xl flex-col gap-5', 'data-route-usable': 'grammar-lessons'},
      h('div', {class: 'grid gap-4 sm:grid-cols-2'}, cards),
      null);
  }

  async function load() {
    const current = ++generation;
    legacyHost.replaceChildren(loading());
    try {
      const raw = await viewData(url.pathname + url.search, signal);
      if (signal.aborted || current !== generation) return;
      legacyHost.replaceChildren(render(lessonsCatalogueDTO(raw)));
    } catch {
      if (signal.aborted || current !== generation) return;
      legacyHost.replaceChildren(RegionFailureNotice({
        region: 'grammar-lessons', message: dict.common.error, retryLabel: dict.errorPage.retry, refresh: load,
      }));
    }
  }

  signal.addEventListener('abort', () => { generation++; host.replaceChildren(); }, {once: true});
  void load();
}
