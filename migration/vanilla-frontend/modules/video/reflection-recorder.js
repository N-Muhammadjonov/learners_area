import {el} from '../../js/dom.js';

/** Local reflection recorder (original src/components/audio/LocalReflectionRecorder.tsx + src/lib/audio/recorder.ts).
 * Memory only: the clip is never uploaded or saved. Microphone access happens only after an explicit click.
 * The stream, timers, object URL and listeners are released on stop, hide, visibility change, pagehide and destroy. */

export const REFLECTION_LIMIT_MS = 180000;

export class RecorderError extends Error {
 constructor(code, message) {
  super(message);
  this.name = 'RecorderError';
  this.code = code;
 }
}

/** Preference order; the first container the browser really supports wins. */
const CANDIDATES = [
 { mimeType: 'audio/webm;codecs=opus' },
 { mimeType: 'audio/webm' },
 { mimeType: 'audio/ogg;codecs=opus' },
 { mimeType: 'audio/mp4' },
 { mimeType: 'audio/aac' },
 { mimeType: '' },
];

export function isRecordingSupported() {
 return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function pickMimeType() {
 if (typeof window === 'undefined' || !window.MediaRecorder) return null;
 for (const candidate of CANDIDATES) {
  if (!candidate.mimeType) return candidate;
  if (window.MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
 }
 return null;
}

/** Creates a recorder bound to a fresh getUserMedia stream; stop()/cancel() always release that stream. */
export async function createRecorder({ signal, permissionTimeoutMs = 30000, onError } = {}) {
 if (!isRecordingSupported()) throw new RecorderError('unsupported', 'This browser cannot record audio.');
 const chosen = pickMimeType();
 if (!chosen) throw new RecorderError('unsupported', 'No supported audio container in this browser.');

 let stream;
 try {
  stream = await new Promise((resolve, reject) => {
   let settled = false;
   const fail = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    signal?.removeEventListener('abort', fail);
    reject(new RecorderError('unknown', 'Microphone request was cancelled or timed out.'));
   };
   const timeout = setTimeout(fail, permissionTimeoutMs);
   if (signal?.aborted) {
    fail();
    return;
   }
   signal?.addEventListener('abort', fail, { once: true });
   navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (value) => {
     if (settled) {
      for (const track of value.getTracks()) track.stop();
      return;
     }
     settled = true;
     clearTimeout(timeout);
     signal?.removeEventListener('abort', fail);
     resolve(value);
    },
    (error) => {
     if (settled) return;
     settled = true;
     clearTimeout(timeout);
     signal?.removeEventListener('abort', fail);
     reject(error);
    },
   );
  });
 } catch (error) {
  if (error instanceof RecorderError) throw error;
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') throw new RecorderError('permission_denied', 'Microphone permission was denied.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new RecorderError('no_microphone', 'No microphone was found.');
  throw new RecorderError('unknown', 'Could not start the microphone.');
 }

 let recorder;
 try {
  recorder = new MediaRecorder(stream, chosen.mimeType ? { mimeType: chosen.mimeType } : undefined);
 } catch {
  for (const track of stream.getTracks()) track.stop();
  throw new RecorderError('unknown', 'Could not create the audio recorder.');
 }
 const chunks = [];
 const startedAt = Date.now();
 let stoppedAt = null;
 const releaseStream = () => {
  for (const track of stream.getTracks()) track.stop();
 };
 recorder.addEventListener('dataavailable', (event) => {
  if (event.data && event.data.size > 0) chunks.push(event.data);
 });
 recorder.addEventListener('error', () => {
  releaseStream();
  try {
   if (recorder.state !== 'inactive') recorder.stop();
  } catch {
   /* Already failed. */
  }
  onError?.(new RecorderError('unknown', 'The audio recorder failed.'));
 });

 return {
  async start() {
   recorder.start(250); // short timeslices: several chunks rather than one large buffer
  },
  stop() {
   if (recorder.state === 'inactive') {
    releaseStream();
    return Promise.resolve(null);
   }
   return new Promise((resolve) => {
    const deadline = setTimeout(() => {
     releaseStream();
     resolve(null);
    }, 5000);
    recorder.addEventListener('stop', () => {
     clearTimeout(deadline);
     stoppedAt = Date.now();
     releaseStream();
     if (chunks.length === 0) {
      resolve(null);
      return;
     }
     const blob = new Blob(chunks, { type: recorder.mimeType || chosen.mimeType || 'audio/webm' });
     resolve({ blob, mimeType: blob.type, durationMs: (stoppedAt ?? Date.now()) - startedAt, size: blob.size });
    }, { once: true });
    try {
     recorder.stop();
    } catch {
     clearTimeout(deadline);
     releaseStream();
     resolve(null);
    }
   });
  },
  cancel() {
   try {
    if (recorder.state !== 'inactive') recorder.stop();
   } catch {
    /* Track release must still succeed if the recorder has failed. */
   } finally {
    releaseStream();
   }
  },
  elapsedMs: () => (stoppedAt ?? Date.now()) - startedAt,
 };
}

/** "1:05" label, as the original formatDuration. */
export function formatDuration(ms) {
 const total = Math.max(0, Math.round(ms / 1000));
 return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function createReflectionRecorder({ dict, signal }) {
 const t = dict.videoLesson.voiceSummary;
 let alive = true;
 let generation = 0;
 let busy = false;
 let stopping = false;
 let active = false;
 let phase = 'idle';
 let elapsed = 0;
 let playbackUrl = null;
 let errorText = '';
 let recorder = null;
 let request = null;
 let tick = null;
 let deadline = null;
 let elapsedNode = null;
 let audioNode = null;

 const root = el('div', { class: 'space-y-3 rounded-xl border border-ink-100 p-4', 'data-local-reflection': '' });
 const slot = el('div', { class: 'flex flex-col gap-3' });
 const alertNode = el('p', { role: 'alert' });
 root.append(el('p', { class: 'text-sm font-medium' }, t.temporary), el('p', { class: 'text-xs text-ink-500' }, `${t.notSaved} ${t.limit}`), slot, alertNode);
 root.hidden = true;

 function clearTimers() {
  if (tick) clearInterval(tick);
  if (deadline) clearTimeout(deadline);
  tick = null;
  deadline = null;
 }
 function discardPlayback() {
  if (audioNode) {
   audioNode.pause();
   audioNode.removeAttribute('src');
   audioNode.load();
   audioNode.remove();
   audioNode = null;
  }
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = null;
 }
 function destroy() {
  generation++;
  request?.abort();
  request = null;
  recorder?.cancel();
  recorder = null;
  clearTimers();
  discardPlayback();
  busy = false;
  stopping = false;
 }
 function render() {
  slot.replaceChildren();
  elapsedNode = null;
  if (phase === 'idle') {
   const button = el('button', { class: 'btn-secondary min-h-11', type: 'button' }, playbackUrl ? t.again : t.record);
   button.addEventListener('click', () => void record(), { signal });
   slot.append(button);
  }
  if (phase === 'requesting') slot.append(el('p', { role: 'status' }, t.requesting));
  if (phase === 'recording') {
   elapsedNode = el('span', { role: 'status' }, `${t.recording} ${formatDuration(elapsed)}`);
   const stopButton = el('button', { class: 'btn-primary min-h-11', type: 'button' }, t.stop);
   stopButton.addEventListener('click', () => void stop(), { signal });
   slot.append(el('div', { class: 'flex flex-wrap items-center gap-3' }, elapsedNode, stopButton));
  }
  if (phase === 'stopping') slot.append(el('p', { role: 'status' }, t.preparing));
  if (playbackUrl) {
   const remove = el('button', { class: 'btn-secondary', type: 'button' }, dict.common.delete);
   remove.addEventListener('click', () => {
    discardPlayback();
    elapsed = 0;
    render();
   }, { signal });
   audioNode = el('audio', { controls: '', preload: 'metadata', 'aria-label': t.listen, class: 'w-full max-w-full', src: playbackUrl });
   slot.append(remove, audioNode);
  }
  alertNode.textContent = errorText;
  alertNode.hidden = !errorText;
 }
 function setPhase(next) {
  phase = next;
  render();
 }

 async function stop() {
  const current = recorder;
  if (!current || stopping) return;
  stopping = true;
  clearTimers();
  setPhase('stopping');
  const token = generation;
  try {
   const result = await current.stop();
   if (!alive || token !== generation) return;
   discardPlayback();
   if (result?.size) {
    playbackUrl = URL.createObjectURL(result.blob);
   } else {
    errorText = t.noAudio;
   }
  } catch {
   if (alive && token === generation) errorText = t.failed;
  } finally {
   current.cancel();
   if (token === generation) {
    recorder = null;
    stopping = false;
    busy = false;
    if (alive) setPhase('idle');
   }
  }
 }

 async function record() {
  if (busy || !active || !alive) return;
  busy = true;
  discardPlayback();
  errorText = '';
  elapsed = 0;
  setPhase('requesting');
  const token = ++generation;
  const controller = new AbortController();
  request = controller;
  const failed = (cause) => {
   if (!alive || token !== generation) return;
   destroy();
   errorText = cause instanceof RecorderError && cause.code === 'permission_denied' ? t.permissionDenied
    : cause instanceof RecorderError && ['unsupported', 'no_microphone'].includes(cause.code) ? t.unavailable
    : t.failed;
   setPhase('idle');
  };
  try {
   const current = await createRecorder({ signal: controller.signal, permissionTimeoutMs: 15000, onError: failed });
   if (!alive || token !== generation || controller.signal.aborted) {
    current.cancel();
    return;
   }
   recorder = current;
   await current.start();
   if (!alive || token !== generation) {
    current.cancel();
    return;
   }
   errorText = '';
   setPhase('recording');
   tick = setInterval(() => {
    elapsed = Math.min(current.elapsedMs(), REFLECTION_LIMIT_MS);
    if (elapsedNode) elapsedNode.textContent = `${t.recording} ${formatDuration(elapsed)}`;
   }, 200);
   deadline = setTimeout(() => void stop(), REFLECTION_LIMIT_MS);
  } catch (cause) {
   failed(cause);
  }
 }

 // Hidden or leaving the Summary tab: never leave a microphone or a player running.
 function hide() {
  audioNode?.pause();
  if (recorder) void stop();
  else if (busy) {
   generation++;
   request?.abort();
   busy = false;
   setPhase('idle');
  }
 }
 const onVisibility = () => {
  if (document.visibilityState === 'hidden') hide();
 };
 const onPageHide = () => {
  destroy();
  if (alive) {
   errorText = '';
   elapsed = 0;
   setPhase('idle');
  }
 };
 document.addEventListener('visibilitychange', onVisibility);
 window.addEventListener('pagehide', onPageHide);
 signal.addEventListener('abort', () => {
  alive = false;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  destroy();
 }, { once: true });

 render();
 return {
  node: root,
  setActive(next) {
   active = next;
   root.hidden = !next;
   if (!next) hide();
  },
  destroy() {
   alive = false;
   document.removeEventListener('visibilitychange', onVisibility);
   window.removeEventListener('pagehide', onPageHide);
   destroy();
  },
 };
}
