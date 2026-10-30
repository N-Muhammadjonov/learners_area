import {h} from '../../js/native.js';
import {Card} from '../../js/generated/ui.js';
import {Button} from '../shared/presentation.js';
import {apiErrorMessage} from '../../js/api-error-message.js';
import {grammarPracticeDTO} from '../../js/adapters/grammar-v48.js';
import {createScopedPost} from './request.js';

/**
 * Translate With It and Activate It (the original PracticeActivities).
 * The verdict is shown with the structure checklist that produced it. A text-evaluated
 * verdict names the evaluator. Each item has its own textarea and result nodes, so input
 * is never rebuilt and one committed verdict is never discarded by another item's check.
 */
export function PracticeActivities({context, dict, exercises}) {
  const {signal} = context;
  const t = dict.grammar;
  const post = createScopedPost(signal);
  const translatable = exercises.filter(e => e.translatePromptUz);
  const activatable = exercises.filter(e => e.activationPrompt);

  if (translatable.length === 0 && activatable.length === 0) {
    return h(Card, {'data-practice-empty': ''},
      h('h2', {class: 'font-display text-lg text-ink-900'}, t.practiceTitle),
      h('p', {class: 'mt-1 text-sm text-ink-500'}, t.practiceEmpty));
  }

  const views = new Map();
  const results = new Map();
  const busy = new Set();
  const errorNode = h('p', {role: 'alert', class: 'text-sm text-band-bad', hidden: true});
  let error = '';

  /** Structure verdicts have their own wording; anything else is the evaluator's vocabulary. */
  function verdictText(verdict) {
    const structure = {correct: t.verdictCorrect, partial: t.verdictPartial, incorrect: t.verdictIncorrect, undetermined: t.verdictUndetermined};
    return structure[verdict] ?? dict.coach.verdicts[verdict] ?? verdict;
  }

  function item(activity, ex) {
    const key = `${activity}:${ex.id}`;
    const translate = activity === 'translate_it';
    const prompt = translate ? ex.translatePromptUz : ex.activationPrompt;
    const textarea = h('textarea', {
      class: 'input mt-2 min-h-[70px] w-full',
      ...(translate ? {'data-translate-input': ex.id} : {'data-activate-input': ex.id}),
    });
    const button = Button({variant: 'secondary', onClick: () => void check(ex, activity), ...(translate ? {'data-translate-check': ex.id} : {'data-activate-check': ex.id})});
    const verdict = h('span', {class: 'text-sm text-ink-700', hidden: true, ...(translate ? {'data-translate-verdict': ''} : {'data-activate-verdict': ''})});
    const checkedBy = h('span', {class: 'text-xs text-ink-300', hidden: true, ...(translate ? {} : {'data-practice-checked-by': ''})});
    const details = h('div', {class: 'mt-2 text-xs text-ink-500', hidden: true, ...(translate ? {'data-translate-structures': ''} : {})});
    const node = h('div', {
      class: 'rounded-sm bg-paper-sunken p-3',
      ...(translate ? {'data-translate': ex.id} : {'data-activate': ex.id}),
    },
    h('p', {class: 'text-sm text-ink-900'}, prompt),
    translate && ex.targetStructures.length > 0
      ? h('p', {class: 'mt-1 text-xs text-ink-300'}, `${t.targetStructures}: ${ex.targetStructures.join(' · ')}`)
      : null,
    textarea,
    h('div', {class: 'mt-2 flex flex-wrap items-center gap-3'}, button, verdict, checkedBy),
    details);
    textarea.addEventListener('input', () => paintItem(key), {signal});
    const view = {key, textarea, button, verdict, checkedBy, details, translate};
    views.set(key, view);
    return node;
  }

  function paintItem(key) {
    const view = views.get(key);
    const result = results.get(key) ?? null;
    const pending = busy.has(key);
    view.button.disabled = pending || view.textarea.value.trim().length < 2;
    view.button.textContent = pending ? dict.common.saving : t.checkMine;
    if (!result) {
      view.verdict.hidden = true;
      view.checkedBy.hidden = true;
      view.details.hidden = true;
      view.details.replaceChildren();
      return;
    }
    const passed = result.verdict === 'correct';
    view.verdict.hidden = false;
    view.verdict.dataset[view.translate ? 'translateVerdict' : 'activateVerdict'] = result.verdict;
    view.verdict.className = view.translate
      ? `text-sm ${passed ? 'text-band-good' : 'text-ink-700'}`
      : `${passed ? 'text-band-good' : 'text-ink-700'}`;
    view.verdict.textContent = verdictText(result.verdict);
    if (view.translate) {
      view.checkedBy.hidden = true;
      view.details.hidden = false;
      view.details.replaceChildren(
        result.used.length > 0 ? h('p', null, `${t.structuresUsed}: ${result.used.join(', ')}`) : null,
        result.missing.length > 0 ? h('p', {class: 'text-band-bad'}, `${t.structuresMissing}: ${result.missing.join(', ')}`) : null,
        h('p', {class: 'mt-1 text-ink-300'}, `${t.sampleAnswer}: ${result.sampleAnswer}`),
        h('p', {class: 'text-ink-300'}, result.explanation));
    } else {
      view.verdict.className = 'flex flex-wrap items-center gap-2 text-sm';
      view.verdict.replaceChildren(h('span', {class: passed ? 'text-band-good' : 'text-ink-700'}, verdictText(result.verdict)));
      view.checkedBy.hidden = !result.checkedBy;
      view.checkedBy.textContent = result.checkedBy ? `${dict.coach.checkedBy} ${result.checkedBy}` : '';
      view.details.hidden = false;
      view.details.replaceChildren(
        result.missing.length > 0 ? h('p', {class: 'text-band-bad'}, `${t.structuresMissing}: ${result.missing.join(', ')}`) : null,
        result.issues.length > 0 ? h('ul', {class: 'list-inside list-disc'}, result.issues.map(issue => h('li', null, issue))) : null,
        h('p', {class: 'text-ink-300'}, result.explanation));
    }
  }

  function paintError() {
    errorNode.hidden = !error;
    errorNode.textContent = error;
  }

  async function check(ex, activity) {
    const key = `${activity}:${ex.id}`;
    const view = views.get(key);
    if (!view || busy.has(key) || view.textarea.value.trim().length < 2) return;
    busy.add(key);
    error = '';
    paintItem(key);
    paintError();
    const response = await post(`/api/grammar/exercises/${ex.id}/practice`, {activity, answer: view.textarea.value}, {timeoutMs: 60000});
    if (!response) {
      if (!signal.aborted) { busy.delete(key); paintItem(key); }
      return;
    }
    busy.delete(key);
    if (!response.ok) {
      error = apiErrorMessage(response.error, response.error?.status, dict);
    } else {
      try {
        results.set(key, grammarPracticeDTO(response.data));
      } catch {
        error = dict.apiErrors.generic;
      }
    }
    paintItem(key);
    paintError();
  }

  const sections = [];
  if (translatable.length > 0) {
    sections.push(h(Card, {'data-translate-block': ''},
      h('h2', {class: 'font-display text-lg text-ink-900'}, t.translateTitle),
      h('p', {class: 'mt-1 text-xs text-ink-300'}, t.translateHint),
      h('div', {class: 'mt-3 flex flex-col gap-4'}, translatable.map(ex => item('translate_it', ex)))));
  }
  if (activatable.length > 0) {
    sections.push(h(Card, {'data-activate-block': ''},
      h('h2', {class: 'font-display text-lg text-ink-900'}, t.activateTitle),
      h('p', {class: 'mt-1 text-xs text-ink-300'}, t.activateHint),
      h('div', {class: 'mt-3 flex flex-col gap-4'}, activatable.map(ex => item('activate_it', ex)))));
  }
  for (const key of views.keys()) paintItem(key);
  paintError();
  return h('div', {class: 'flex flex-col gap-4'}, ...sections, errorNode);
}
