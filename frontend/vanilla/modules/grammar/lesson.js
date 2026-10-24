import {h} from '../../js/native.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {grammarLessonDTO} from '../../js/adapters/grammar-v48.js';
import {render as lessonBody} from '../../js/generated/ListeningLessonBody-v10.js';
import {Card} from '../../js/generated/ui.js';
import {BackLink, RegionFailureNotice} from '../shared/presentation.js';
import {lessonWorkspace} from '../courses/workspace.js';
import {lessonQuiz} from '../listening/lesson-quiz.js';
import {lessonNotes} from '../notes/lesson-notes.js';
import {mount as notFound} from '../not-found.js';

const TABS = ['description', 'teacher-notes', 'xulosangiz'];

/** Grammar lesson detail `/app/grammar/lessons/:lessonId?tab=` (the original page, same structure and order). */
export function mount(context) {
  const {root, url, signal, dict} = context;
  const lessonId = url.pathname.split('/')[4] ?? '';
  const host = h('div', {'data-grammar-lesson-host': lessonId});
  root.append(host);
  const t = {...dict.listening.lessons, areaLabel: dict.grammar.lessonsTitle};
  const requested = url.searchParams.get('tab');
  const tab = TABS.includes(requested) ? requested : 'description';
  let generation = 0;

  function tabLabel(candidate) {
    return t.tabs[candidate === 'teacher-notes' ? 'teacherNotes' : candidate];
  }

  function mediaNodes(detail, mediaUrl) {
    const media = detail.media;
    if (!media) return null;
    if (media.mediaKind === 'audio' && mediaUrl) {
      const suffix = media.durationSeconds ? ` · ${Math.round(media.durationSeconds / 60)} ${t.minutes}` : '';
      return h('figure', {class: 'mb-4 flex flex-col gap-2'},
        h('audio', {controls: true, preload: 'none', class: 'w-full', src: mediaUrl, 'data-grammar-lesson-audio': ''}),
        h('figcaption', {class: 'text-xs text-ink-300'}, `${t.mediaKind.audio}${suffix}`));
    }
    if (media.mediaKind === 'video' && mediaUrl) {
      return h('video', {controls: true, preload: 'none', class: 'mb-4 w-full rounded-md bg-ink-950', src: mediaUrl, 'data-grammar-lesson-video': ''});
    }
    if (!mediaUrl) {
      // A provider-hosted item is played by the canonical media studio, not by a second player here.
      return h('p', {class: 'mb-4 text-sm text-ink-500', 'data-grammar-lesson-media-elsewhere': ''},
        h('a', {class: 'underline', href: `/app/video-lessons/${media.id}`, 'data-grammar-lesson-media-link': ''}, media.title));
    }
    return null;
  }

  function panel(detail) {
    if (tab === 'description') {
      return h('div', {class: 'flex flex-col gap-2'},
        detail.lesson.summary
          ? h('p', {class: 'text-sm leading-relaxed text-ink-700', 'data-grammar-description': ''}, detail.lesson.summary)
          : h('p', {class: 'text-sm text-ink-500', 'data-grammar-description-empty': ''}, t.descriptionEmpty),
        detail.media?.focus
          ? h('p', {class: 'text-sm leading-relaxed text-ink-700', 'data-grammar-description-focus': ''}, detail.media.focus)
          : null,
        detail.lesson.estimatedMinutes
          ? h('p', {class: 'text-xs text-ink-300'}, t.descriptionMinutes.replace('{n}', String(detail.lesson.estimatedMinutes)))
          : null);
    }
    if (tab === 'teacher-notes') {
      return h('div', {class: 'flex flex-col gap-2'},
        h('p', {class: 'text-xs text-ink-300'}, detail.teacherNotesSource === 'media' ? t.teacherNotesLegacyHint : t.teacherNotesHint),
        detail.teacherNotes
          ? h('p', {
            class: 'whitespace-pre-line text-sm leading-relaxed text-ink-700',
            'data-grammar-teacher-notes': '', 'data-teacher-notes-source': detail.teacherNotesSource ?? 'none',
          }, detail.teacherNotes)
          : h('p', {class: 'text-sm text-ink-500', 'data-grammar-teacher-notes-empty': ''}, t.teacherNotesEmpty));
    }
    // The learner's private note: the same panel and store course lessons use, keyed by this lesson's id.
    return h('div', {class: 'flex flex-col gap-2'},
      h('p', {class: 'text-xs text-ink-300'}, t.xulosangizHint),
      lessonNotes(context, {lessonId: detail.lesson.id, initialNotes: detail.note}));
  }

  function page(detail) {
    const mediaUrl = detail.mediaUrl;
    const workspace = lessonWorkspace(context, {
      lessonId: detail.lesson.id,
      state: detail.progress.state,
      completedAt: detail.progress.completedAt ? new Date(detail.progress.completedAt) : null,
      showNotes: false,
    });
    return h('div', {class: 'mx-auto flex max-w-3xl flex-col gap-5', 'data-route-usable': 'grammar-lesson'},
      h('div', null,
        BackLink({fallbackHref: '/app/grammar/lessons', label: dict.grammar.lessonBack, 'data-grammar-lesson-back': ''}),
        h('h1', {class: 'mt-2 font-display text-2xl text-ink-900'}, detail.lesson.title),
        h('p', {class: 'mt-1 text-xs uppercase tracking-wide text-ink-300'}, t.areaLabel)),
      h(Card, {'data-grammar-lesson-body-card': ''},
        h('h2', {class: 'mb-3 font-display text-lg text-ink-900'}, t.bodyTitle),
        mediaNodes(detail, mediaUrl),
        lessonBody({dict, blocks: detail.blocks, LessonQuizBlock: props => lessonQuiz(context, props)})),
      workspace,
      h('div', {class: 'flex flex-wrap gap-2', role: 'tablist', 'data-grammar-lesson-tabs': ''},
        TABS.map(candidate => h('a', {
          key: candidate,
          href: `/app/grammar/lessons/${detail.lesson.id}?tab=${candidate}`,
          role: 'tab',
          'aria-selected': String(tab === candidate),
          class: tab === candidate ? 'btn-primary' : 'btn-secondary',
          'data-grammar-lesson-tab': candidate,
          'data-active': tab === candidate ? 'true' : 'false',
        }, tabLabel(candidate)))),
      h(Card, {'data-grammar-lesson-panel': tab}, panel(detail)));
  }

  function teardownMedia() {
    for (const media of host.querySelectorAll('audio,video')) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
  }

  async function load() {
    const current = ++generation;
    if (!uuid(lessonId)) {
      host.replaceChildren();
      await notFound({...context, root: host});
      return;
    }
    host.replaceChildren(h('div', {role: 'status', 'aria-busy': 'true', class: 'h-32 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': 'grammar-lesson'}));
    try {
      const raw = await viewData(url.pathname, signal);
      if (signal.aborted || current !== generation) return;
      if (raw?.kind === 'not_found') {
        host.replaceChildren();
        await notFound({...context, root: host});
        return;
      }
      host.replaceChildren(page(grammarLessonDTO(raw, lessonId)));
    } catch (error) {
      if (signal.aborted || current !== generation) return;
      if (error?.status === 404) {
        host.replaceChildren();
        await notFound({...context, root: host});
        return;
      }
      host.replaceChildren(RegionFailureNotice({
        region: 'grammar-lesson', message: dict.common.error, retryLabel: dict.errorPage.retry, refresh: load,
      }));
    }
  }

  signal.addEventListener('abort', () => {
    generation++;
    teardownMedia();
    host.replaceChildren();
  }, {once: true});
  void load();
}
