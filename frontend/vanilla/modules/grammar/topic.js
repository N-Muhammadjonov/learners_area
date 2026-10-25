import {h} from '../../js/native.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {grammarTopicDTO} from '../../js/adapters/grammar-v48.js';
import {render as resourceBlocks} from '../../js/generated/ResourceBlocks-v8.js';
import {EmptyState} from '../../js/generated/ui.js';
import {BackLink, RegionFailureNotice} from '../shared/presentation.js';
import {clickableText} from '../vocabulary/clickable-text.js';
import {mount as notFound} from '../not-found.js';
import {TopicMasteryCard} from './mastery.js';
import {GrammarQuiz} from './quiz.js';
import {PracticeActivities} from './practice.js';

/**
 * Grammar topic detail `/app/grammar/:topicId` (the original page).
 * The page is built once per topic and exercise set. A retry of a materials or mastery notice
 * refreshes only those slots, so Correct It answers and Write Your Own text are never lost.
 */
export function mount(context) {
  const {root, url, signal, dict} = context;
  const topicId = url.pathname.split('/')[3] ?? '';
  const host = h('div', {'data-grammar-topic-host': topicId});
  root.append(host);
  const t = dict.grammar;
  let generation = 0;
  let built = null;

  function skeleton() {
    return h('div', {'aria-hidden': 'true', class: 'h-16 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': 'grammar-topic'});
  }

  function materialsNode(detail) {
    if (!detail.materials.ok) {
      return RegionFailureNotice({region: 'grammar-materials', message: dict.errors.unknown, retryLabel: dict.errorPage.retry, refresh: load});
    }
    return resourceBlocks({
      dict, blocks: detail.materials.blocks, ClickableText: props => clickableText(context, props).node,
    });
  }

  function masteryNode(detail) {
    if (detail.masteryUnavailable) {
      return RegionFailureNotice({region: 'grammar-topic-mastery', message: dict.errors.unknown, retryLabel: dict.errorPage.retry, refresh: load});
    }
    return detail.mastery ? TopicMasteryCard({dict, mastery: detail.mastery}) : null;
  }

  function fill(detail) {
    const material = materialsNode(detail);
    built.materialsSlot.replaceChildren(...(material ? [material] : []));
    const mastery = built.hasExercises ? masteryNode(detail) : null;
    built.masterySlot.replaceChildren(...(mastery ? [mastery] : []));
    built.noticeSlot.replaceChildren();
  }

  function build(detail, key) {
    const hasExercises = detail.exercises.length > 0;
    const materialsSlot = h('div', {'data-grammar-materials': ''});
    const masterySlot = h('div', {'data-grammar-mastery': ''});
    const noticeSlot = h('div', {'data-grammar-notice': ''});
    const exerciseSlot = h('div', {class: 'flex flex-col gap-4'});
    if (hasExercises) {
      exerciseSlot.append(
        GrammarQuiz({context, dict, topicId: detail.topic.id, exercises: detail.exercises}),
        PracticeActivities({context, dict, exercises: detail.exercises}));
    } else {
      exerciseSlot.append(h(EmptyState, {
        title: t.noExercises,
        action: h('a', {href: '/app/grammar', class: 'text-sm text-signal-600 underline'}, t.backToTopics),
      }));
    }
    host.replaceChildren(h('div', {class: 'mx-auto flex max-w-3xl flex-col gap-4', 'data-grammar-topic': detail.topic.id},
      h('div', null,
        BackLink({fallbackHref: '/app/grammar', label: t.backToTopics}),
        h('h1', {class: 'mt-2 font-display text-2xl text-ink-900'}, detail.topic.title),
        h('p', {class: 'academic-text text-sm text-ink-500'}, detail.topic.explanation)),
      materialsSlot,
      noticeSlot,
      masterySlot,
      exerciseSlot));
    built = {key, materialsSlot, masterySlot, noticeSlot, hasExercises};
    fill(detail);
  }

  async function missing() {
    built = null;
    host.replaceChildren();
    await notFound({...context, root: host});
  }

  async function load() {
    const current = ++generation;
    if (!uuid(topicId)) {
      await missing();
      return;
    }
    if (!built) host.replaceChildren(skeleton());
    try {
      const raw = await viewData(url.pathname, signal);
      if (signal.aborted || current !== generation) return;
      if (raw?.kind === 'not_found') {
        await missing();
        return;
      }
      const detail = grammarTopicDTO(raw, topicId);
      const key = JSON.stringify([detail.topic, detail.exercises]);
      if (!built || built.key !== key) build(detail, key);
      else fill(detail);
    } catch (error) {
      if (signal.aborted || current !== generation) return;
      if (error?.status === 404) {
        await missing();
        return;
      }
      const notice = RegionFailureNotice({region: 'grammar-topic', message: dict.common.error, retryLabel: dict.errorPage.retry, refresh: load});
      if (built) built.noticeSlot.replaceChildren(notice);
      else host.replaceChildren(notice);
    }
  }

  signal.addEventListener('abort', () => {
    generation++;
    built = null;
    host.replaceChildren();
  }, {once: true});
  void load();
}
