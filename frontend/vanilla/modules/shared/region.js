import {h} from '../../js/native.js';
import {viewData, viewSnapshot, requireFields} from '../../js/adapters/frontend.js';
import {RegionFailureNotice} from './presentation.js';
import {anySignal} from '../../js/signals.js';

/** Reads ONE projection region of a route. Each controller owns its generation: a newer
 * request (retry, repeat navigation) or an aborted route makes an older response inert. */
export function projection({route, region, signal, parse, loading, ready, failed, lifecycle}) {
  let generation = 0, initial = true, request;
  lifecycle?.onPause?.(()=>{generation++;request?.abort();});
  const refresh = async ({background=false}={}) => {
    const current = ++generation;
    if (signal.aborted) return;
    request?.abort();request=new AbortController();const requestSignal=anySignal([signal,request.signal]);
    const force=!initial&&!background;initial=false;
    const snapshot=viewSnapshot(route,region);
    let shown=false;
    if(snapshot)try{requireFields(snapshot.data,[region]);ready(parse(snapshot.data[region]));shown=true;}catch{}
    if(shown&&!snapshot.stale&&!force)return;
    if(!shown)loading();
    let data;
    try {
      const raw = await viewData(route, requestSignal, region, {fresh:force||shown});
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
