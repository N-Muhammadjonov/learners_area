import {h} from '../../js/native.js';
import {fmtDate} from '../shared/dates.js';

/** One assignment card. Every fact shown is server data; nothing here is inferred (no overdue, no grade, no status). */
export function assignmentCard(view) {
  const {a, dict, locale, detail, detailsState, draft, busy, notice, error, onInput, onSubmit, onRetryDetails} = view;
  const t = dict.assignments;
  const isBusy = busy.has(a.id);
  const evaluation = detail?.evaluation ?? null;
  const completed = a.status === 'completed';
  // Gate: the server's completion flag is authoritative (the submit route marks completed in the same transaction as the
  // evaluation). Details only enrich the card, so a details outage never locks a learner out of a task that is not done.
  const canEdit = !completed && !evaluation;
  // The server's status is shown as-is; an unrecognised value shows no label rather than a guessed one.
  const statusLabel = t.status[a.status] ?? '';
  const verdict = evaluation?.verdict && dict.coach.verdicts[evaluation.verdict];

  const children = [
    h('div', {class: 'flex flex-wrap items-center justify-between gap-2'},
      h('h2', {class: 'text-base font-semibold text-ink-900'}, a.title),
      h('span', {class: 'badge', 'data-assignment-status-label': a.status}, statusLabel)),
    a.description ? h('p', {class: 'text-sm text-ink-500'}, a.description) : null,
    a.instructions ? h('div', {class: 'flex flex-col gap-1', 'data-assignment-instructions': ''},
      h('h3', {class: 'text-xs font-semibold uppercase tracking-wide text-ink-300'}, t.instructions),
      h('p', {class: 'whitespace-pre-line text-sm text-ink-700'}, a.instructions)) : null,
    a.dueAt ? h('p', {class: 'text-xs text-ink-300', 'data-assignment-due': ''}, `${t.due} ${fmtDate(a.dueAt, locale)}`) : null,
    materials(view),
  ];

  if (notice.get(a.id)) children.push(h('p', {role: 'status', class: 'text-sm font-medium text-ink-900', 'data-assignment-notice': ''}, notice.get(a.id)));

  if (evaluation) {
    children.push(h('p', {class: 'text-xs text-ink-500', 'data-checked-by': evaluation.checkedByName, 'data-assignment-evaluation': ''},
      `${dict.coach.checkedBy} ${evaluation.checkedByName}${verdict ? ` · ${verdict}` : ''}`));
  } else if (completed && detailsState === 'error') {
    children.push(detailsError(dict, t.detailsUnavailable, 'data-assignment-metadata-unavailable', onRetryDetails));
  }

  if (canEdit) {
    const id = `assignment-response-${a.id}`;
    const hintId = `${id}-hint`;
    children.push(
      h('label', {for: id, class: 'text-sm font-medium text-ink-700'}, t.responseLabel),
      h('textarea', {
        id, class: 'input min-h-[110px] w-full', value: draft ?? '', disabled: isBusy,
        'aria-describedby': hintId, 'data-assignment-response': a.id,
        onInput: (e) => onInput(a.id, e.target.value),
      }),
      h('p', {id: hintId, class: 'text-xs text-ink-300'}, t.responseHint),
      error.get(a.id) ? h('p', {role: 'alert', class: 'text-xs text-band-bad', 'data-assignment-error': ''}, error.get(a.id)) : null,
      h('div', {},
        h('button', {
          type: 'button', class: 'btn-primary w-fit', disabled: isBusy, 'aria-busy': String(isBusy),
          'data-assignment-submit': a.id, onClick: () => onSubmit(a),
        }, isBusy ? dict.common.saving : t.submit)));
  }

  return h('article', {class: 'card flex min-w-0 flex-col gap-2 p-4', id: 'assignment-'+a.id, 'data-assignment-card': '', 'data-assignment-id': a.id, 'data-assignment-status': a.status}, children);
}

/** Details are a separate source: its failure is a local notice with its own retry, never a removed card. */
function detailsError(dict, text, attr, onRetry) {
  return h('div', {class: 'flex flex-wrap items-center justify-between gap-2'},
    h('p', {role: 'status', class: 'text-xs text-band-warn', [attr]: ''}, text),
    h('button', {type: 'button', class: 'btn-secondary', 'data-assignment-details-retry': '', onClick: () => onRetry?.()}, dict.errorPage.retry));
}

function materials(view) {
  const {detail, detailsState, dict, onRetryDetails} = view;
  if (detailsState === 'loading') return h('p', {class: 'text-xs text-ink-300', role: 'status', 'data-assignment-materials-loading': ''}, dict.common.loading);
  if (detailsState === 'error') return detailsError(dict, dict.assignments.materialsUnavailable, 'data-assignment-materials-unavailable', onRetryDetails);
  const blocks = detail?.materials ?? [];
  if (blocks.length === 0) return null;
  return h('section', {class: 'card flex flex-col gap-2 p-4', 'data-assignment-materials': '', 'aria-label': dict.resources.studentsTitle},
    h('h3', {class: 'text-sm font-semibold text-ink-900'}, dict.resources.studentsTitle),
    h('ul', {class: 'flex flex-col gap-2'}, blocks.map((b) => h('li', {'data-resource-block': b.type}, block(b, dict)))));
}

function block(b, dict) {
  const r = dict.resources;
  if (b.type === 'text') return h('p', {class: 'whitespace-pre-line text-sm text-ink-700'}, b.textContent ?? '');
  if (b.type === 'link' && b.linkUrl) return h('a', {href: b.linkUrl, target: '_blank', rel: 'noopener noreferrer', class: 'btn-secondary'}, b.originalName ?? r.openLink);
  // Private objects are served by the existing authenticated resource route; the key is never a public URL.
  if (b.type === 'image' && b.objectKey) return h('img', {src: `/api/resources/${b.objectKey}`, alt: b.originalName ?? r.blockImage, class: 'max-h-80 w-auto rounded-sm border border-ink-100', loading: 'lazy'});
  if (b.type === 'audio' && b.objectKey) return h('div', {class: 'flex flex-col gap-1'},
    h('span', {class: 'text-xs text-ink-300'}, b.originalName ?? ''),
    h('audio', {controls: true, preload: 'none', src: `/api/resources/${b.objectKey}`, class: 'w-full'}, r.blockAudio));
  if (b.type === 'file' && b.objectKey) return h('a', {href: `/api/resources/${b.objectKey}`, class: 'btn-secondary'}, b.originalName ?? r.blockFile);
  return null;
}
