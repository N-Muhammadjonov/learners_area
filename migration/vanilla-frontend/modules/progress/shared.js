import {h} from '../../js/native.js';
import {viewData, requireFields} from '../../js/adapters/frontend.js';
import {RegionFailureNotice} from '../shared/presentation.js';

/** Reads ONE projection region of `/app/progress`. Each controller owns its generation: a newer
 * request (retry, repeat navigation) or an aborted route makes an older response inert. */
export function projection({route, region, signal, parse, loading, ready, failed}) {
  let generation = 0;
  const refresh = async () => {
    const current = ++generation;
    if (signal.aborted) return;
    loading();
    let data;
    try {
      const raw = await viewData(route, signal, region);
      if (signal.aborted || current !== generation) return;
      requireFields(raw, [region]);
      data = parse(raw[region]);
    } catch {
      if (signal.aborted || current !== generation) return;
      failed(refresh);
      return;
    }
    if (signal.aborted || current !== generation) return;
    try {
      ready(data);
    } catch {
      if (!signal.aborted && current === generation) failed(refresh);
    }
  };
  signal.addEventListener('abort', () => { generation++; }, {once: true});
  return refresh;
}

/** Non-blocking loading placeholder; announced to assistive technology while pending. */
export function loadingNode(dict, name) {
  return h('div', {
    role: 'status', 'aria-busy': 'true', 'aria-label': dict.common.loading,
    class: 'h-32 animate-pulse rounded-xl bg-ink-50', 'data-async-loading': name,
  });
}

/** Region-level failure with its own retry; never blanks sibling regions. */
export function failureNode({region, message, retry, refresh}) {
  return RegionFailureNotice({region, message, retryLabel: retry, refresh});
}

export function show(value) {
  return value === null || value === undefined ? '—' : String(value);
}

export function dlRow(label, value) {
  return h('div', {class: 'flex justify-between'},
    h('dt', {class: 'text-ink-500'}, label),
    h('dd', {class: 'text-ink-900'}, value));
}

