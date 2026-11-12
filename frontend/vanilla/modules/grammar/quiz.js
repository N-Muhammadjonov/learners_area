import {h} from '../../js/native.js';
import {Card} from '../../js/generated/ui.js';
import {Button} from '../shared/presentation.js';
import {apiErrorMessage} from '../../js/api-error-message.js';
import {grammarSubmitDTO} from '../../js/adapters/grammar-v48.js';
import {createScopedPost} from './request.js';
import {ProductionAnswer} from './production.js';

/**
 * Correct It (the original GrammarQuiz): one radio group per exercise and a single submit.
 * The server is the only grader; correct options and explanations appear only from its response.
 * Cards are built once and painted in place, so the Write Your Own textareas keep their text.
 */
export function GrammarQuiz({context, dict, topicId, exercises}) {
  const {signal} = context;
  const t = dict.grammar;
  const post = createScopedPost(signal);
  const answers = new Map();
  const views = new Map();
  let results = null;
  let submitting = false;
  let error = '';

  const errorNode = h('p', {role: 'alert', class: 'text-sm text-band-bad', hidden: true});
  const submit = Button({variant: 'primary', onClick: () => void onSubmit()});
  const retry = Button({variant: 'secondary', onClick: () => {
    if (!results || submitting) return;
    results = null;
    answers.clear();
    error = '';
    paint();
  }});
  retry.dataset.grammarGroupRetry = '';
  const actions = h('div', {class: 'flex flex-wrap items-center gap-3',
    'data-grammar-quiz-actions': ''}, submit, retry);

  for (const ex of exercises) {
    const radios = [];
    const resultLine = h('p', {class: 'mt-2 text-xs text-ink-500', hidden: true});
    const options = ex.options.map(opt => {
      const input = h('input', {type: 'radio', name: ex.id, value: opt});
      input.addEventListener('change', () => {
        if (results) return;
        answers.set(ex.id, opt);
        paint();
      }, {signal});
      const span = h('span', null, opt);
      radios.push({opt, input, span});
      return h('label', {class: 'flex items-center gap-2 text-sm text-ink-700'}, input, span);
    });
    const card = h(Card, {}, h('div', {class: 'mb-2 flex items-center justify-between'},
      h('p', {class: 'text-xs font-medium uppercase tracking-wide text-ink-300'}, `${ex.order}. ${t.pickCorrect}`),
      ex.fromEssay ? h('span', {class: 'badge bg-signal-100 text-signal-700'}, t.fromYourEssay) : null),
    h('p', {class: 'mb-3 text-sm italic text-ink-500'}, ex.promptText),
    h('div', {class: 'flex flex-col gap-1.5'}, options),
    resultLine,
    ProductionAnswer({context, dict, exerciseId: ex.id}));
    card.dataset.exerciseId = ex.id;
    views.set(ex.id, {card, radios, resultLine});
  }

  const node = h('div', {class: 'flex flex-col gap-4', 'data-grammar-quiz': topicId},
    errorNode,
    ...exercises.map(ex => views.get(ex.id).card),
    actions);

  function paint() {
    for (const ex of exercises) {
      const view = views.get(ex.id);
      const result = results?.get(ex.id) ?? null;
      view.card.className = `card p-5 ${result ? (result.isCorrect ? 'border-band-good/40' : 'border-band-bad/40') : ''}`;
      for (const radio of view.radios) {
        radio.input.checked = answers.get(ex.id) === radio.opt;
        radio.input.disabled = results !== null;
        radio.span.className = result && radio.opt === result.correctOption ? 'font-medium text-band-good' : '';
      }
      if (result) {
        view.resultLine.hidden = false;
        view.resultLine.replaceChildren(
          h('span', {class: result.isCorrect ? 'font-medium text-band-good' : 'font-medium text-band-bad'},
            result.isCorrect ? t.correct : t.incorrect),
          ` — ${result.explanation}`);
      } else {
        view.resultLine.hidden = true;
        view.resultLine.replaceChildren();
      }
    }
    // `btn-primary` sets display, which would override the `hidden` attribute; hide with inline style.
    submit.style.display = results ? 'none' : '';
    retry.style.display = results && [...results.values()].some(row => !row.isCorrect) ? '' : 'none';
    retry.textContent = dict.common.retry ?? 'Qayta urinish';
    submit.disabled = submitting || answers.size < exercises.length;
    submit.textContent = submitting ? dict.common.loading : t.submit;
    errorNode.hidden = !error;
    errorNode.textContent = error;
  }

  async function onSubmit() {
    if (submitting || results || answers.size !== exercises.length) return;
    submitting = true;
    error = '';
    paint();
    const response = await post(`/api/grammar/topics/${topicId}/submit`, {
      answers: exercises.map(e => ({exerciseId: e.id, selectedOption: answers.get(e.id) ?? ''})),
    });
    if (!response) {
      if (!signal.aborted) { submitting = false; paint(); }
      return;
    }
    submitting = false;
    if (!response.ok) {
      error = apiErrorMessage(response.error, response.error?.status, dict);
    } else {
      try {
        results = grammarSubmitDTO(response.data, exercises);
      } catch {
        error = dict.apiErrors.generic;
      }
    }
    paint();
  }

  paint();
  return node;
}
