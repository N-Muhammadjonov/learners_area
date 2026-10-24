import {h} from '../../js/native.js';
import {viewData} from '../../js/adapters/frontend.js';
import {lessonsCatalogueDTO} from '../../js/adapters/listening-lessons-v10.js';
import {RegionFailureNotice} from '../shared/presentation.js';

/** Grammar lessons catalogue `/app/grammar/lessons?page=N` (the original GrammarLibraryResults). */
export function mount(context) {
  const {root, url, signal, dict} = context;
  const host = h('div', {'data-grammar-lessons-host': ''});
  root.append(host);
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
      h('nav', {class: 'flex gap-3', 'aria-label': dict.readingHub.page},
        page > 1 ? h('a', {class: 'btn-secondary', href: pageHref(page - 1), rel: 'prev'}, dict.readingHub.prevPage) : null,
        p.library.hasMore ? h('a', {class: 'btn-secondary', href: pageHref(page + 1), rel: 'next'}, dict.readingHub.nextPage) : null));
  }

  async function load() {
    const current = ++generation;
    host.replaceChildren(loading());
    try {
      const raw = await viewData(url.pathname + url.search, signal);
      if (signal.aborted || current !== generation) return;
      host.replaceChildren(render(lessonsCatalogueDTO(raw)));
    } catch {
      if (signal.aborted || current !== generation) return;
      host.replaceChildren(RegionFailureNotice({
        region: 'grammar-lessons', message: dict.common.error, retryLabel: dict.errorPage.retry, refresh: load,
      }));
    }
  }

  signal.addEventListener('abort', () => { generation++; host.replaceChildren(); }, {once: true});
  void load();
}
