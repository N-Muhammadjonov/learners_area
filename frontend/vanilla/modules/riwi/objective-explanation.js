import { RiwiClientAdapter } from "../../js/adapters/riwi.js";
import { tRiwi } from "../../js/i18n/riwi_i18n.js";
import { escapeHtml } from "./index.js";

export function renderObjectiveExplanationWidget({
  module = "reading",
  attemptId,
  questionId,
  attemptSubmitted = false,
  locale = "uz",
  explanationData = null
}) {
  if (!attemptSubmitted) {
    return "";
  }
  if (!explanationData) {
    return `<div class="riwi-objective-widget" data-module="${escapeHtml(module)}" data-attempt-id="${escapeHtml(attemptId)}" data-question-id="${escapeHtml(questionId)}">
      <button type="button" class="riwi-btn riwi-btn--explain">${escapeHtml(tRiwi("riwi.objective.explainBtn", locale))}</button>
    </div>`;
  }
  return `<div class="riwi-objective-widget riwi-objective-widget--resolved" data-module="${escapeHtml(module)}">
    <p class="riwi-objective-widget__text">${escapeHtml(explanationData.explanation)}</p>
  </div>`;
}

export async function loadObjectiveExplanation({
  module,
  attemptId,
  questionId,
  locale = "uz",
  adapter = RiwiClientAdapter
}) {
  return adapter.explainObjectiveQuestion({ module, attemptId, questionId, locale });
}
