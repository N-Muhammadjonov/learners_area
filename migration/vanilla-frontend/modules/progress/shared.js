import {h} from '../../js/native.js';
export {projection, loadingNode, failureNode} from '../shared/region.js';

export function show(value) {
  return value === null || value === undefined ? '—' : String(value);
}

export function dlRow(label, value) {
  return h('div', {class: 'flex justify-between'},
    h('dt', {class: 'text-ink-500'}, label),
    h('dd', {class: 'text-ink-900'}, value));
}

