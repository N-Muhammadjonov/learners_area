import {api} from '../../js/api-client.js';

/**
 * Owner-scoped POST for one Grammar widget (quiz, production answer, practice item).
 * - A same-key request already in flight is ignored (double press cannot send a second write).
 * - Owner teardown (route change) aborts the wait; the server still decides what was committed.
 * - Mutations are never retried (api-client guarantees this).
 * - Different keys run independently, so one committed verdict is never discarded by another check.
 * Returns `{ok:true, data}`, `{ok:false, error}`, or `null` when nothing should be shown.
 */
export function createScopedPost(signal) {
  const inFlight = new Set();
  return async function post(path, body, {timeoutMs} = {}) {
    if (signal.aborted) return null;
    const key = `${path}\n${JSON.stringify(body ?? null)}`;
    if (inFlight.has(key)) return null;
    inFlight.add(key);
    try {
      const data = await api.request(path, {method: 'POST', body, signal, timeoutMs});
      if (signal.aborted) return null;
      return {ok: true, data};
    } catch (error) {
      if (signal.aborted) return null;
      return {ok: false, error};
    } finally {
      inFlight.delete(key);
    }
  };
}
