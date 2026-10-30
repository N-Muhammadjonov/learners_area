import {h} from '../../js/native.js';
import {Button} from '../shared/presentation.js';
import {apiErrorMessage} from '../../js/api-error-message.js';
import {grammarProduceDTO} from '../../js/adapters/grammar-v48.js';
import {createScopedPost} from './request.js';

/**
 * "Write your own correction" for one Grammar item (the original ProductionAnswer).
 * Sample answer, explanation and issues appear only after the server has recorded the attempt.
 * The textarea is created once, so typed text survives every verdict update.
 */
export function ProductionAnswer({context, dict, exerciseId}) {
  const {signal} = context;
  const t = dict.grammar;
  const post = createScopedPost(signal);
  const inputId = `produce-${exerciseId}`;
  let busy = false;
  let result = null;

  const textarea = h('textarea', {id: inputId, class: 'input min-h-[70px]', 'aria-busy': 'false'});
  const error = h('p', {role: 'alert', class: 'text-xs text-band-bad', hidden: true});
  const check = Button({variant: 'secondary', onClick: () => void run()});
  const checkedBy = h('span', {class: 'text-xs text-ink-500', hidden: true});
  const sample = h('p', {class: 'text-xs text-ink-300'});
  const explanation = h('p', {class: 'academic-text text-xs text-ink-500'});
  const issues = h('ul', {class: 'list-inside list-disc text-xs text-ink-500'});
  const details = h('div', {class: 'flex flex-col gap-1 rounded-sm bg-paper-sunken p-3', hidden: true}, sample, explanation, issues);

  const node = h('div', {class: 'mt-3 flex flex-col gap-2 border-t border-ink-100 pt-3', 'data-production-answer': exerciseId},
    h('label', {for: inputId, class: 'text-sm font-medium text-ink-700'}, t.writeYourOwn),
    textarea,
    error,
    h('div', {class: 'flex flex-wrap items-center gap-3'}, check, checkedBy),
    details);

  function paint() {
    textarea.disabled = busy;
    textarea.setAttribute('aria-busy', String(busy));
    check.disabled = busy || textarea.value.trim().length < 3;
    check.textContent = busy ? dict.common.saving : t.checkMine;
    if (!result) {
      checkedBy.hidden = true;
      details.hidden = true;
      return;
    }
    const label = result.verdict ? (dict.coach.verdicts[result.verdict] ?? result.verdict) : '';
    checkedBy.hidden = false;
    checkedBy.dataset.checkedBy = result.checkedBy;
    checkedBy.replaceChildren(
      h('span', {class: result.verdict === 'correct' ? 'text-band-good' : 'text-ink-700'}, label),
      ` · ${dict.coach.checkedBy} ${result.checkedBy}`);
    sample.textContent = `${t.sampleAnswer}: ${result.sampleAnswer}`;
    explanation.textContent = result.explanation;
    issues.replaceChildren(...result.issues.map(issue => h('li', null, issue)));
    details.hidden = false;
  }

  async function run() {
    if (busy || textarea.value.trim().length < 3) return;
    busy = true;
    error.hidden = true;
    paint();
    const answer = textarea.value.trim();
    const response = await post(`/api/grammar/exercises/${exerciseId}/produce`, {answer}, {timeoutMs: 60000});
    if (!response) {
      if (!signal.aborted) { busy = false; paint(); }
      return;
    }
    busy = false;
    if (!response.ok) {
      error.textContent = apiErrorMessage(response.error, response.error?.status, dict);
      error.hidden = false;
    } else {
      try {
        result = grammarProduceDTO(response.data);
      } catch {
        error.textContent = dict.apiErrors.generic;
        error.hidden = false;
      }
    }
    paint();
  }

  textarea.addEventListener('input', paint, {signal});
  paint();
  return node;
}
