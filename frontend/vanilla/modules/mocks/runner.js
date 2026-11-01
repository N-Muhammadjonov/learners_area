/**
 * Weekly IELTS Full Mock Catalogue, Timed Runner (Listening, Reading, Writing, Speaking),
 * and Student Result Breakdown (`/app/mocks`).
 *
 * Reuses existing Learners Area shell, theme tokens (`card`, `panel`, `chip`, `btn-primary`,
 * `btn-secondary`, `input`, `badge`), and 3D campus navigation with NO module sidebar.
 */
import {el, listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {createLocalTranscriptCapture} from './local-transcript.js';

const STRINGS = {
  en: {
    weeklyBadge: 'Weekly IELTS Mock · Academic / General',
    available: 'Available',
    scheduled: 'Scheduled',
    unavailable: 'Content unavailable',
    startMock: 'Start mock',
    continueMock: 'Continue mock',
    viewResults: 'View results',
    backToCatalogue: '← All Mock Tests',
    awaitingGrading: 'Awaiting grading',
    underReview: 'Under review',
    published: 'Published',
    inProgress: 'In progress',
    completed: 'Completed',
    weeklyLimitNotice: 'Weekly policy: 1 formal full mock per week (Asia/Tashkent). You can resume your active mock anytime before the deadline.',
    examConditions: 'Exam conditions: no transcript, official answer key or dictionary.',
    audioPlayer: 'Listening audio (Official single-play exam mode)',
    startListeningAudio: '▶ Start Listening audio (single play)',
    resumeListeningAudio: '▶ Resume interrupted audio',
    listeningPlaying: 'Audio playing — single play active',
    listeningCompleted: 'Listening audio playback completed (replay disabled)',
    listeningOtherTab: 'Listening audio is currently active in another tab.',
    listeningNetRecovery: 'Network interruption detected — you may resume from your last verified position.',
    sectionMaterials: 'Section materials',
    questionsHeading: 'Questions',
    nextPart: 'Next part →',
    submitSection: 'Submit section',
    submitting: 'Submitting…',
    unsaved: 'Unsaved changes',
    saving: 'Saving draft…',
    saved: 'Saved',
    saveFailed: 'Save failed — retry',
    retrySave: 'Retry save',
    contentUnavailableTitle: 'Official mock material unavailable',
    contentUnavailableBody: 'Required published questions or media for this section could not be verified. Formal mock exams never substitute synthetic questions.',
    retryLoad: 'Retry loading material',
    task1Label: 'Task 1 (20 min · 150+ words)',
    task2Label: 'Task 2 (40 min · 250+ words)',
    wordsCount: 'Words',
    yourEssayPlaceholder: 'Write your response here. Spellcheck, auto-correction and translation are disabled under exam conditions.',
    speakingTitle: 'Speaking Assessment (Parts 1, 2 & 3)',
    speakingHint: 'Record each part clearly using your microphone. Your original audio is verified and saved privately for examiner review.',
    recordPart: '● Record',
    stopRecording: '■ Stop & upload',
    recordingNow: 'Recording live audio…',
    uploadingAudio: 'Uploading & verifying audio…',
    retryAudioUpload: 'Retry audio upload',
    recordedFinalized: 'Audio verified & finalized',
    replayRecording: 'Replay recorded audio',
    micPermissionDenied: 'Microphone permission was denied. Please allow microphone access in your browser settings and try again.',
    micDisconnected: 'Microphone disconnected during recording. Please reconnect your microphone and record this part again.',
    micUnsupported: 'This browser does not support required audio recording (MediaRecorder / getUserMedia).',
    micEmpty: 'No audible speech data was captured. Please record again before finalizing.',
    resultTitle: 'Mock Result & Feedback',
    estimateBadge: 'IELTS-equivalent estimate',
    overallBand: 'Overall Band',
    pendingOverall: 'Pending (awaiting all 4 sections)',
    pendingSectionNote: 'Writing and Speaking grades appear after Teacher/Owner review and publication.',
    rawScoreLabel: 'Raw score',
    bandLabel: 'Band',
    criteriaHeading: 'Official Criteria Breakdown',
    feedbackHeading: 'Examiner Feedback & Action Plan',
    mistakesHeading: 'Quoted Mistakes & Revisions',
    partFeedbackHeading: 'Part-by-Part Speaking Observations',
  },
  uz: {
    weeklyBadge: 'Haftalik IELTS Mock · Academic / General',
    available: 'Mavjud',
    scheduled: 'Rejalashtirilgan',
    unavailable: 'Material mavjud emas',
    startMock: 'Mockni boshlash',
    continueMock: 'Mockni davom ettirish',
    viewResults: 'Natijani ko‘rish',
    backToCatalogue: '← Barcha Mock testlar',
    awaitingGrading: 'Baholanmoqda',
    underReview: 'Tekshiruvda',
    published: 'E’lon qilingan',
    inProgress: 'Jarayonda',
    completed: 'Yakunlangan',
    weeklyLimitNotice: 'Haftalik qoida: haftasiga 1 ta to‘liq mock (Asia/Tashkent). Boshlangan urinishni muddat tugaguncha davom ettirish mumkin.',
    examConditions: 'Imtihon sharoiti: transkript, javoblar kaliti va lug‘at o‘chirilgan.',
    audioPlayer: 'Listening audio (1 marta eshitish rejimi)',
    startListeningAudio: '▶ Audioni boshlash (1 marta)',
    resumeListeningAudio: '▶ Uzilgan audioni davom ettirish',
    listeningPlaying: 'Audio ijro etilmoqda — qayta eshitish cheklangan',
    listeningCompleted: 'Listening audio yakunlandi (qayta qo‘yib bo‘lmaydi)',
    listeningOtherTab: 'Listening audio boshqa oynada ijro etilmoqda.',
    listeningNetRecovery: 'Tarmoq uzilishi aniqlandi — oxirgi tasdiqlangan joydan davom ettirishingiz mumkin.',
    sectionMaterials: 'Bo‘lim materiallari',
    questionsHeading: 'Savollar',
    nextPart: 'Keyingi qism →',
    submitSection: 'Bo‘limni topshirish',
    submitting: 'Topshirilmoqda…',
    unsaved: 'Saqlanmagan o‘zgarishlar',
    saving: 'Saqlanmoqda…',
    saved: 'Saqlandi',
    saveFailed: 'Saqlashda xatolik — qayta urinib ko‘ring',
    retrySave: 'Qayta saqlash',
    contentUnavailableTitle: 'Rasmiy mock materiali topilmadi',
    contentUnavailableBody: 'Ushbu bo‘lim uchun tasdiqlangan savollar yoki audio topilmadi. Soxta savollar yaratilmaydi.',
    retryLoad: 'Qayta yuklash',
    task1Label: 'Task 1 (20 daqiqa · 150+ so‘z)',
    task2Label: 'Task 2 (40 daqiqa · 250+ so‘z)',
    wordsCount: 'So‘zlar',
    yourEssayPlaceholder: 'Javobingizni shu yerga yozing. Imtihon sharoitida avto-tuzatish va tarjima o‘chirilgan.',
    speakingTitle: 'Speaking bo‘limi (Part 1, 2 va 3)',
    speakingHint: 'Har bir qismni mikrofon orqali aniq yozib oling. Asl audio yozuv tekshirilib xavfsiz saqlanadi.',
    recordPart: '● Yozib olish',
    stopRecording: '■ To‘xtatish va yuklash',
    recordingNow: 'Ovoz yozib olinmoqda…',
    uploadingAudio: 'Audio yuklanmoqda va tekshirilmoqda…',
    retryAudioUpload: 'Audioni qayta yuklash',
    recordedFinalized: 'Audio tekshirildi va saqlandi',
    replayRecording: 'Yozilgan audioni eshitish',
    micPermissionDenied: 'Mikrofon ruxsati berilmadi. Brauzer sozlamalaridan mikrofonga ruxsat bering.',
    micDisconnected: 'Yozish vaqtida mikrofon uzilib qoldi. Mikrofonni qayta ulab, qaytadan yozib oling.',
    micUnsupported: 'Ushbu brauzer audio yozib olishni (MediaRecorder / getUserMedia) qo‘llab-quvvatlamaydi.',
    micEmpty: 'Ovozli ma’lumot yozilmadi. Iltimos, qaytadan yozib oling.',
    resultTitle: 'Mock natijasi va tahlil',
    estimateBadge: 'IELTS-ekvivalent taxminiy baho',
    overallBand: 'Umumiy Band',
    pendingOverall: 'Kutilmoqda (4 ta bo‘lim tasdiqlangach chiqadi)',
    pendingSectionNote: 'Writing va Speaking natijalari o‘qituvchi yoki markaz rahbari tasdiqlaganidan so‘ng ko‘rinadi.',
    rawScoreLabel: 'Xom ball',
    bandLabel: 'Band',
    criteriaHeading: 'Mezonlar bo‘yicha baholar',
    feedbackHeading: 'Tahlil va tavsiyalar',
    mistakesHeading: 'Xatolar va tuzatishlar',
    partFeedbackHeading: 'Qismlar bo‘yicha Speaking izohlari',
  },
};

const SPEAKING_MIME_CANDIDATES = [
  ['audio/webm;codecs=opus', 'webm', 'audio/webm'],
  ['audio/webm', 'webm', 'audio/webm'],
  ['audio/ogg;codecs=opus', 'ogg', 'audio/ogg'],
  ['audio/ogg', 'ogg', 'audio/ogg'],
  ['audio/mp4', 'mp4', 'audio/mp4'],
  ['audio/aac', 'aac', 'audio/aac'],
  ['audio/wav', 'wav', 'audio/wav'],
];

const MIN_VALID_AUDIO_BYTES = 64;

export class MockRunnerError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'MockRunnerError';
    this.code = code;
    this.status = status;
  }
}

function labelsFor(context) {
  return context?.locale === 'uz' ? STRINGS.uz : STRINGS.en;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function countWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Pure FIPS 180-4 SHA-256 implementation over Uint8Array so binary SHA-256
 * is always exact even in environments without SubtleCrypto.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256BytesSync(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const bitLenHi = Math.floor((bytes.length * 8) / 0x100000000);
  const bitLenLo = (bytes.length * 8) >>> 0;
  const padLen = ((bytes.length + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, bitLenHi, false);
  view.setUint32(padLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * TASK 1: Calculate SHA-256 from a real recorded Blob's binary bytes.
 * Never accepts fabricated strings or empty 0-byte recordings.
 */
export async function sha256FromBlob(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new MockRunnerError('empty_recording', 'A valid audio Blob is required.');
  }
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  if (!bytes || bytes.byteLength <= 0) {
    throw new MockRunnerError('empty_recording', 'Recorded audio Blob is empty.');
  }
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to pure FIPS 180-4 SHA-256 over the exact Uint8Array bytes
    }
  }
  return sha256BytesSync(bytes);
}

/**
 * TASK 1: Select a browser-supported audio MIME type for MediaRecorder.
 */
export function selectSupportedSpeakingMime(MediaRecorderCtor = globalThis.MediaRecorder, nav = globalThis.navigator) {
  if (typeof MediaRecorderCtor === 'undefined' || !nav?.mediaDevices?.getUserMedia) {
    throw new MockRunnerError('unsupported_format', 'MediaRecorder or getUserMedia is not supported in this browser.');
  }
  for (const [mimeType, codec, canonicalMime] of SPEAKING_MIME_CANDIDATES) {
    if (typeof MediaRecorderCtor.isTypeSupported !== 'function' || MediaRecorderCtor.isTypeSupported(mimeType)) {
      return {mimeType, codec, canonicalMime};
    }
  }
  throw new MockRunnerError('unsupported_format', 'No supported audio recording MIME format is available.');
}

/**
 * TASK 1: Real MediaRecorder controller for Speaking Parts 1, 2, and 3.
 * Handles permission denial, device disconnection (`ended` on track), unsupported formats,
 * and guarantees media track release on stop, error, or route abort.
 */
export async function createMockSpeakingRecorder({
  signal,
  part,
  attemptId,
  questionIds = [],
  captureMode = 'part',
  onDisconnect,
} = {}) {
  if (!part || !['P1', 'P2', 'P3'].includes(part)) {
    throw new MockRunnerError('invalid_part', 'Speaking part must be P1, P2, or P3.');
  }
  if (!attemptId) {
    throw new MockRunnerError('invalid_attempt', 'Mock attemptId is required.');
  }
  const chosen = selectSupportedSpeakingMime();
  if (signal?.aborted) {
    throw new MockRunnerError('aborted', 'Recording cancelled before microphone acquisition.');
  }

  let stream;
  try {
    stream = await globalThis.navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const errName = err?.name || '';
    if (errName === 'NotAllowedError' || errName === 'SecurityError' || errName === 'PermissionDeniedError') {
      throw new MockRunnerError('permission_denied', 'Microphone permission was denied.');
    }
    if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errName === 'OverconstrainedError') {
      throw new MockRunnerError('no_microphone', 'No working microphone device was found.');
    }
    throw new MockRunnerError('microphone_error', err?.message || 'Unable to access microphone.');
  }

  const getAllTracks = () => [
    ...(typeof stream?.getAudioTracks === 'function' ? stream.getAudioTracks() : []),
    ...(typeof stream?.getTracks === 'function' ? stream.getTracks() : []),
  ];
  const uniqueTracks = Array.from(new Set(getAllTracks()));

  let released = false;
  let disconnected = false;
  let recorder = null;
  let startedAtMs = 0;
  const chunks = [];
  const transcription=captureMode==='question'?createLocalTranscriptCapture({signal}):null;

  const handleTrackEnded = () => {
    if (!released && recorder && recorder.state === 'recording') {
      disconnected = true;
      transcription?.cancel();
      try {
        recorder.stop();
      } catch {
        // ignore
      }
      releaseTracks();
      onDisconnect?.();
    }
  };

  function releaseTracks() {
    if (released) return;
    released = true;
    for (const t of uniqueTracks) {
      try {
        t.removeEventListener?.('ended', handleTrackEnded);
      } catch {
        // ignore
      }
      try {
        t.stop?.();
      } catch {
        // ignore
      }
    }
  }

  if (signal?.aborted) {
    releaseTracks();
    throw new MockRunnerError('aborted', 'Route aborted during microphone acquisition.');
  }

  for (const t of uniqueTracks) {
    t.addEventListener?.('ended', handleTrackEnded);
  }

  try {
    recorder = new globalThis.MediaRecorder(stream, chosen.mimeType ? {mimeType: chosen.mimeType} : undefined);
  } catch (err) {
    transcription?.cancel();releaseTracks();
    throw new MockRunnerError('unsupported_format', err?.message || 'Failed to initialize MediaRecorder.');
  }

  recorder.addEventListener('dataavailable', ev => {
    if (ev?.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  });

  const onSignalAbort = () => {
    transcription?.cancel();
    try {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch {
      // ignore
    }
    releaseTracks();
  };
  signal?.addEventListener('abort', onSignalAbort, {once: true});

  return {
    part,
    attemptId,
    questionIds: [...questionIds],
    mimeType: chosen.canonicalMime,
    codec: chosen.codec,
    async start() {
      if (released || disconnected || signal?.aborted) {
        releaseTracks();
        throw new MockRunnerError('aborted', 'Recorder is no longer active.');
      }
      chunks.length = 0;
      startedAtMs = Date.now();
      try {
        recorder.start(250);
        transcription?.start();
      } catch (err) {
        transcription?.cancel();releaseTracks();
        throw new MockRunnerError('microphone_error', err?.message || 'Could not start audio recording.');
      }
    },
    async stop() {
      signal?.removeEventListener?.('abort', onSignalAbort);
      if (disconnected) {
        releaseTracks();
        throw new MockRunnerError('device_disconnected', 'Microphone was disconnected during recording.');
      }
      const transcriptPromise=transcription?.stop();
      await new Promise((resolve, reject) => {
        if (!recorder || recorder.state === 'inactive') {
          resolve();
          return;
        }
        const stopTimer = setTimeout(() => {
          releaseTracks();
          resolve();
        }, 5000);
        recorder.addEventListener('stop', () => {
          clearTimeout(stopTimer);
          resolve();
        }, {once: true});
        recorder.addEventListener('error', ev => {
          clearTimeout(stopTimer);
          releaseTracks();
          transcription?.cancel();reject(new MockRunnerError('microphone_error', ev?.error?.message || 'MediaRecorder error during capture.'));
        }, {once: true});
        try {
          recorder.stop();
        } catch {
          clearTimeout(stopTimer);
          resolve();
        }
      });

      releaseTracks();

      if (disconnected) {
        throw new MockRunnerError('device_disconnected', 'Microphone was disconnected during recording.');
      }

      const durationMs = Math.max(1000, Date.now() - (startedAtMs || Date.now()));
      const blob = new Blob(chunks, {type: chosen.canonicalMime});
      if (!blob || blob.size < MIN_VALID_AUDIO_BYTES) {
        throw new MockRunnerError('empty_recording', 'Recorded audio is empty or too short to contain speech.');
      }
      const transcriptCapture=transcriptPromise?await transcriptPromise:null;
      const sha256 = await sha256FromBlob(blob);
      return {
        blob,
        bytes: blob.size,
        sha256,
        mimeType: chosen.canonicalMime,
        codec: chosen.codec,
        durationMs,
        part,
        attemptId,
        questionIds: [...questionIds],
        captureMode,transcriptCapture,
      };
    },
    cancel() {
      transcription?.cancel();
      signal?.removeEventListener?.('abort', onSignalAbort);
      try {
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch {
        // ignore
      }
      releaseTracks();
    },
  };
}

/**
 * TASK 1 & TASK 2: Authenticated 3-step Speaking audio upload (Intent -> Raw Bytes PUT -> Finalize)
 * with safe idempotent retry using cached uploadIntent on `recording`.
 */
export async function uploadSpeakingPartRecording({
  attemptId,
  part,
  recording,
  signal,
  fetcher = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (!recording || !(recording.blob instanceof Blob) || recording.bytes < MIN_VALID_AUDIO_BYTES || !recording.sha256) {
    throw new MockRunnerError('empty_recording', 'Valid recorded audio Blob and SHA-256 are required before upload.');
  }
  if (!fetcher) {
    throw new MockRunnerError('network_error', 'Fetch transport is unavailable.');
  }

  const parseJsonResponse = async res => {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || !data?.ok) {
      const code = data?.error?.code || data?.code || 'upload_failed';
      const msg = data?.error?.message || data?.message || `Audio upload failed (${res.status})`;
      throw new MockRunnerError(code, msg, res.status);
    }
    return data;
  };

  if(recording.captureMode==='question'){
    const form=new FormData();form.set('part',part);form.set('questionId',recording.questionIds?.[0]||'');
    form.set('durationMs',String(recording.durationMs));form.set('sha256',recording.sha256);
    form.set('transcriptCapture',JSON.stringify(recording.transcriptCapture||{text:'',status:'unavailable'}));
    form.set('audio',recording.blob,'response.'+(recording.codec||'webm'));
    const response=await fetcher(`/api/mocks/attempts/${encodeURIComponent(attemptId)}/speaking/responses`,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},body:form,signal});
    return parseJsonResponse(response);
  }

  // Step 1: Create or reuse authenticated upload intent bound to (student, attemptId, part, sha256, bytes)
  let intent = recording.uploadIntent;
  if (!intent || intent.sha256 !== recording.sha256 || intent.bytes !== recording.bytes) {
    const intentRes = await fetcher(`/api/mocks/attempts/${encodeURIComponent(attemptId)}/speaking/upload-intent`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({
        part,
        codec: recording.codec,
        mimeType: recording.mimeType,
        bytes: recording.bytes,
        durationMs: recording.durationMs,
        sha256: recording.sha256,
        questionIds: recording.questionIds || [],
      }),
      signal,
    });
    const intentData = await parseJsonResponse(intentRes);
    intent = {
      uploadId: intentData.uploadId,
      objectKey: intentData.objectKey,
      uploadUrl: intentData.uploadUrl || `/api/mocks/attempts/${encodeURIComponent(attemptId)}/speaking/uploads/${encodeURIComponent(intentData.uploadId)}`,
      sha256: recording.sha256,
      bytes: recording.bytes,
    };
    recording.uploadIntent = intent;
  }

  // Step 2: Upload the actual binary audio bytes (skip if already uploaded on a previous retry where only finalize failed)
  if (!recording.bytesUploaded) {
    const rawBuffer = await recording.blob.arrayBuffer();
    const putRes = await fetcher(intent.uploadUrl, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': recording.mimeType,
        'X-Content-Sha256': recording.sha256,
        Accept: 'application/json',
      },
      body: rawBuffer,
      signal,
    });
    await parseJsonResponse(putRes);
    recording.bytesUploaded = true;
  }

  // Step 3: Finalize and verify stored object + SHA-256 on backend
  const finRes = await fetcher(`/api/mocks/attempts/${encodeURIComponent(attemptId)}/speaking/upload-finalize`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({
      uploadId: intent.uploadId,
      part,
      objectKey: intent.objectKey,
      codec: recording.codec,
      mimeType: recording.mimeType,
      bytes: recording.bytes,
      durationMs: recording.durationMs,
      sha256: recording.sha256,
      questionIds: recording.questionIds || [],
    }),
    signal,
  });
  return parseJsonResponse(finRes);
}

/**
 * TASK 5: Validate that a section has real published material and never substitute synthetic questions.
 */
export function validateSectionMaterialForRunner(section, writingTasks = []) {
  if (!section || typeof section !== 'object') {
    return {valid: false, code: 'missing_section', message: 'Section configuration is missing.'};
  }
  const skill = section.skill;
  const mat = section.material || {};

  if (skill === 'listening') {
    const questions = Array.isArray(mat.questions) ? mat.questions : [];
    const expectedCount = Number(section.questionCount) || 40;
    if (!mat.audioUrl || typeof mat.audioUrl !== 'string' || !mat.audioUrl.trim()) {
      return {valid: false, code: 'missing_listening_audio', message: 'Official Listening audio is unavailable for this mock.'};
    }
    if (questions.length < expectedCount || questions.some(q => !q || !q.id || !(q.question_text || q.questionText))) {
      return {valid: false, code: 'invalid_listening_questions', message: `Expected ${expectedCount} published Listening questions, found ${questions.length}.`};
    }
    return {valid: true};
  }

  if (skill === 'reading') {
    const questions = Array.isArray(mat.questions) ? mat.questions : [];
    const passages = Array.isArray(mat.passages) ? mat.passages : [];
    const expectedCount = Number(section.questionCount) || 40;
    if (passages.length === 0 || passages.some(p => !p || !String(p.bodyText || '').trim())) {
      return {valid: false, code: 'missing_reading_passages', message: 'Published Reading passages are unavailable for this mock.'};
    }
    if (questions.length < expectedCount || questions.some(q => !q || !q.id || !(q.question_text || q.questionText))) {
      return {valid: false, code: 'invalid_reading_questions', message: `Expected ${expectedCount} published Reading questions, found ${questions.length}.`};
    }
    return {valid: true};
  }

  if (skill === 'writing') {
    const t1 = Array.isArray(writingTasks) ? writingTasks.find(t => t.taskType === 'task1') : null;
    const t2 = Array.isArray(writingTasks) ? writingTasks.find(t => t.taskType === 'task2') : null;
    if (!t1 || !String(t1.prompt || '').trim() || !t2 || !String(t2.prompt || '').trim()) {
      return {valid: false, code: 'missing_writing_prompts', message: 'Published Writing Task 1 and Task 2 prompts are required.'};
    }
    return {valid: true};
  }

  if (skill === 'speaking') {
    const parts = Array.isArray(mat.parts) ? mat.parts : [];
    const hasAllParts = ['P1', 'P2', 'P3'].every(pCode =>
      parts.some(p => p && p.part === pCode && p.questionId && String(p.promptText || p.topic || '').trim()),
    );
    if (!hasAllParts) {
      return {valid: false, code: 'missing_speaking_prompts', message: 'Published Speaking Part 1, Part 2, and Part 3 prompts are required.'};
    }
    return {valid: true};
  }

  return {valid: false, code: 'unknown_skill', message: 'Unknown mock section skill.'};
}

/**
 * TASK 4: Server-synchronized Listening single-play controller.
 * Enforces single play across reloads and tabs while permitting recovery from network interruptions.
 */
export function createListeningPlaybackController({
  attemptId,
  tabId,
  audioUrl,
  initialPlayback = null,
  signal,
  apiRequest = (path, opts) => api.request(path, opts),
  onStateChange,
} = {}) {
  const effectiveTabId = tabId || `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  let state = {
    status: initialPlayback?.status || 'not_started', // 'not_started' | 'playing' | 'interrupted' | 'completed' | 'locked_other_tab'
    positionMs: Number(initialPlayback?.positionMs) || 0,
    completedAt: initialPlayback?.completedAt || null,
    activeTabId: initialPlayback?.activeTabId || null,
    error: null,
  };

  const notify = () => onStateChange?.({...state});

  async function syncServer(action, positionMs = state.positionMs) {
    const resp = await apiRequest(`/api/mocks/attempts/${encodeURIComponent(attemptId)}/listening/playback`, {
      method: 'POST',
      body: {
        action,
        tabId: effectiveTabId,
        positionMs: Math.max(0, Math.floor(Number(positionMs) || 0)),
      },
      signal,
    });
    if (resp?.playback) {
      state = {
        ...state,
        status: resp.playback.status || state.status,
        positionMs: Number(resp.playback.positionMs ?? state.positionMs),
        completedAt: resp.playback.completedAt || state.completedAt,
        activeTabId: resp.playback.activeTabId || effectiveTabId,
        error: null,
      };
      notify();
    }
    return resp;
  }

  return {
    tabId: effectiveTabId,
    audioUrl,
    getState() {
      return {...state};
    },
    async requestStartOrResume() {
      if (state.status === 'completed' || state.completedAt) {
        throw new MockRunnerError('listening_replay_forbidden', 'Listening audio has already been played once for this attempt.', 409);
      }
      try {
        const action = state.status === 'interrupted' || state.positionMs > 0 ? 'resume' : 'start';
        await syncServer(action, state.positionMs);
        state.status = 'playing';
        notify();
        return {...state};
      } catch (err) {
        const code = err?.data?.error?.code || err?.code || 'playback_denied';
        if (code === 'listening_already_playing_in_other_tab') {
          state.status = 'locked_other_tab';
        } else if (code === 'listening_replay_forbidden') {
          state.status = 'completed';
        }
        state.error = err?.data?.error?.message || err?.message || code;
        notify();
        throw new MockRunnerError(code, state.error, err?.status || 409);
      }
    },
    async reportProgress(positionMs) {
      if (state.status !== 'playing') return {...state};
      state.positionMs = Math.max(state.positionMs, Math.floor(Number(positionMs) || 0));
      await syncServer('heartbeat', state.positionMs);
      return {...state};
    },
    async reportNetworkInterruption(positionMs = state.positionMs) {
      if (state.status === 'completed') return {...state};
      state.positionMs = Math.max(state.positionMs, Math.floor(Number(positionMs) || 0));
      state.status = 'interrupted';
      notify();
      try {
        await syncServer('interrupt', state.positionMs);
      } catch {
        // Keep local interrupted state so student can resume when connection returns
      }
      return {...state};
    },
    async markCompleted(positionMs = state.positionMs) {
      state.positionMs = Math.max(state.positionMs, Math.floor(Number(positionMs) || 0));
      await syncServer('complete', state.positionMs);
      state.status = 'completed';
      state.completedAt = state.completedAt || new Date().toISOString();
      notify();
      return {...state};
    },
  };
}

/**
 * TASK 6: Reliable, revision-safe autosave manager.
 * Tracks distinct states ('idle' | 'unsaved' | 'saving' | 'saved' | 'failed'),
 * never claims 'Saved' before server confirmation, preserves unsaved payloads on failure,
 * ignores stale out-of-order responses, and flushes pending edits before section submission.
 */
export function createRevisionSafeAutosaveManager({
  attemptId,
  signal,
  initialRevisions = {},
  apiRequest = (path, opts) => api.request(path, opts),
  syncChannel = null,
  onStatusChange,
} = {}) {
  const entries = new Map();
  let lastActiveKey = null;

  function ensureEntry(key) {
    if (!entries.has(key)) {
      entries.set(key, {
        key,
        skill: key === 'task1' || key === 'task2' ? 'writing' : key,
        localRevision: Number(initialRevisions[key]) || 0,
        ackedRevision: Number(initialRevisions[key]) || 0,
        status: 'idle', // 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed'
        pendingBody: null,
        inFlightPromise: null,
        error: null,
      });
    }
    return entries.get(key);
  }

  function emit(entry) {
    lastActiveKey = entry.key;
    onStatusChange?.({
      key: entry.key,
      skill: entry.skill,
      status: entry.status,
      localRevision: entry.localRevision,
      ackedRevision: entry.ackedRevision,
      error: entry.error,
      hasUnsaved: entry.localRevision > entry.ackedRevision || entry.status === 'unsaved' || entry.status === 'failed',
    });
  }

  async function transmit(entry) {
    if (signal?.aborted) return false;
    if (!entry.pendingBody || entry.localRevision <= entry.ackedRevision) {
      entry.status = entry.ackedRevision > 0 ? 'saved' : 'idle';
      emit(entry);
      return true;
    }

    const sendRevision = entry.localRevision;
    const bodyToSend = {...entry.pendingBody, revision: sendRevision};
    entry.status = 'saving';
    entry.error = null;
    emit(entry);

    const runPromise = (async () => {
      try {
        const resp = await apiRequest(
          `/api/mocks/attempts/${encodeURIComponent(attemptId)}/sections/${encodeURIComponent(entry.skill)}/draft`,
          {
            method: 'PUT',
            body: bodyToSend,
            signal,
          },
        );
        if (signal?.aborted) return false;
        if (!resp || resp.ok !== true) {
          throw new MockRunnerError('save_failed', 'Server did not confirm draft storage.');
        }
        // A stale response means the server did NOT save this payload, even if ok=true.
        // Keep the user's changes and require an explicit retry at a revision above
        // the server's latest version; never display a false "Saved" confirmation.
        if (resp.stale === true) {
          if (!entry.pendingBody && entry.ackedRevision >= sendRevision) {
            return true; // A newer local request was already confirmed.
          }
          const remoteRevision = Number(resp.revision);
          if (Number.isSafeInteger(remoteRevision) && remoteRevision >= 0) {
            entry.ackedRevision = Math.max(entry.ackedRevision, remoteRevision);
            entry.localRevision = Math.max(entry.localRevision, entry.ackedRevision + 1);
          }
          throw new MockRunnerError('stale_revision', 'Your draft was not saved because a newer revision exists. Retry to save your changes.');
        }
        const serverRev = Number(resp.revision);
        if (!Number.isSafeInteger(serverRev) || serverRev !== sendRevision) {
          throw new MockRunnerError('save_not_confirmed', 'Server did not confirm this draft revision. Retry to save.');
        }
        if (serverRev > entry.ackedRevision) {
          entry.ackedRevision = serverRev;
        }
        if (entry.localRevision < entry.ackedRevision) {
          entry.localRevision = entry.ackedRevision;
        }
        // Only transition to 'saved' if no newer edit occurred while this request was in flight
        if (entry.localRevision === entry.ackedRevision) {
          entry.pendingBody = null;
          entry.status = 'saved';
          entry.error = null;
          syncChannel?.postMessage?.({
            type: 'draft_saved',
            key: entry.key,
            skill: entry.skill,
            revision: entry.ackedRevision,
            body: bodyToSend,
          });
          emit(entry);
          return true;
        }
        // A newer edit arrived during flight: immediately transmit the newer revision
        return await transmit(entry);
      } catch (err) {
        if (signal?.aborted) return false;
        // If a newer revision already succeeded while an older request failed, do not overwrite 'saved'
        if (entry.ackedRevision >= entry.localRevision && entry.ackedRevision > 0) {
          entry.status = 'saved';
          emit(entry);
          return true;
        }
        entry.status = 'failed';
        entry.error = err?.data?.error?.message || err?.message || 'Save failed — retry';
        emit(entry);
        return false;
      }
    })();

    entry.inFlightPromise = runPromise;
    try {
      return await runPromise;
    } finally {
      if (entry.inFlightPromise === runPromise) {
        entry.inFlightPromise = null;
      }
    }
  }

  return {
    queueChange(key, payloadWithoutRevision) {
      const entry = ensureEntry(key);
      entry.localRevision += 1;
      entry.pendingBody = {...payloadWithoutRevision};
      entry.status = 'unsaved';
      entry.error = null;
      emit(entry);
      return transmit(entry);
    },
    async retry(key = lastActiveKey) {
      if (!key) return false;
      const entry = ensureEntry(key);
      if (!entry.pendingBody && entry.localRevision <= entry.ackedRevision) return true;
      return transmit(entry);
    },
    async flushAll(keys) {
      const targetKeys = Array.isArray(keys) && keys.length > 0 ? keys : Array.from(entries.keys());
      for (const k of targetKeys) {
        const entry = entries.get(k);
        if (!entry) continue;
        if (entry.inFlightPromise) {
          await entry.inFlightPromise;
        }
        if (entry.pendingBody && entry.localRevision > entry.ackedRevision) {
          const ok = await transmit(entry);
          if (!ok) {
            throw new MockRunnerError('autosave_flush_failed', entry.error || 'Unsaved changes could not be saved to the server. Please retry before submitting.');
          }
        }
      }
      return true;
    },
    applyRemoteUpdate(key, remoteRevision) {
      const entry = ensureEntry(key);
      const rev = Number(remoteRevision) || 0;
      if (rev > entry.ackedRevision) {
        entry.ackedRevision = rev;
        if (entry.localRevision <= rev) {
          entry.localRevision = rev;
          entry.pendingBody = null;
          entry.status = 'saved';
          entry.error = null;
          emit(entry);
        }
      }
    },
    getState(key = lastActiveKey) {
      if (!key || !entries.has(key)) {
        return {status: 'idle', localRevision: 0, ackedRevision: 0, hasUnsaved: false, error: null};
      }
      const e = entries.get(key);
      return {
        key: e.key,
        skill: e.skill,
        status: e.status,
        localRevision: e.localRevision,
        ackedRevision: e.ackedRevision,
        hasUnsaved: e.localRevision > e.ackedRevision || e.status === 'unsaved' || e.status === 'failed',
        error: e.error,
      };
    },
    hasUnsavedChanges() {
      for (const e of entries.values()) {
        if (e.localRevision > e.ackedRevision || e.status === 'unsaved' || e.status === 'saving' || e.status === 'failed') {
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * TASK 3: SPA navigation helper that routes all Mock transitions through `context.navigate(...)`
 * while preserving route cleanup, browser Back/Forward (`popstate`), and deep-link hydration.
 */
export function buildMockRouteUrl(attemptId = null, results = false) {
  if (!attemptId) return '/app/mocks';
  const params = new URLSearchParams();
  params.set('attempt', String(attemptId));
  if (results) params.set('results', '1');
  return `/app/mocks?${params.toString()}`;
}

export async function navigateMockRoute(context, host, targetPath, options = {}) {
  if (typeof context?.navigate === 'function') {
    await context.navigate(targetPath, options);
    return;
  }
  const baseOrigin = context?.url?.origin || (typeof window !== 'undefined' ? window.location.origin : 'https://learnersarea.local');
  const nextUrl = new URL(targetPath, baseOrigin);
  await renderMockRouteForUrl({...context, url: nextUrl}, host, nextUrl);
}

const activeHostControllers = new WeakMap();

function beginHostScreenLifetime(host, parentSignal) {
  const prev = activeHostControllers.get(host);
  if (prev) {
    prev.abort('mock-screen-transition');
  }
  const screenController = new AbortController();
  if (parentSignal) {
    if (parentSignal.aborted) {
      screenController.abort(parentSignal.reason);
    } else {
      const onParentAbort = () => screenController.abort(parentSignal.reason);
      parentSignal.addEventListener('abort', onParentAbort, {once: true});
      // Route lifetime can outlive many inner screens. Drop stale parent listeners
      // when each screen is replaced; never accumulate abort listeners per click.
      screenController.signal.addEventListener('abort', () => parentSignal.removeEventListener('abort', onParentAbort), {once: true});
    }
  }
  activeHostControllers.set(host, screenController);
  return screenController.signal;
}

async function renderMockRouteForUrl(context, host, targetUrl) {
  const screenSignal = beginHostScreenLifetime(host, context?.signal);
  if (screenSignal.aborted) return;
  const scopedContext = {...context, url: targetUrl, signal: screenSignal};
  const attemptId = targetUrl.searchParams.get('attempt');
  const showResults = targetUrl.searchParams.get('results') === '1';
  const hadWorkspace = !!host.querySelector?.('[data-mock-enhanced-catalogue], [data-mock-runner], [data-mock-result-summary]');
  if (attemptId || hadWorkspace) {
    host.replaceChildren(el('div', {role: 'status', 'aria-busy': 'true',
      class: 'panel text-sm text-ink-500', 'data-mock-route-loading': ''},
    context?.dict?.common?.loading || 'Loading…'));
  }
  try {
    if (attemptId) {
      if (showResults) await renderResultsScreen(scopedContext, host, attemptId);
      else await renderExamRunnerScreen(scopedContext, host, attemptId);
      return;
    }
    const catalog = await api.request('/api/mocks/catalog', {signal: screenSignal, fresh: true});
    if (screenSignal.aborted) return;
    if (!catalog?.ok) throw new MockRunnerError('mock_catalog_unavailable', 'Mock catalogue unavailable', 503);
    renderEnhancedCatalogue(scopedContext, host, catalog);
  } catch (err) {
    if (screenSignal.aborted) return;
    // If the optional enriched catalogue is offline, the native V55 projection
    // still provides a safe read-only fallback. No placeholder exam is created.
    if (!attemptId && !hadWorkspace) return;
    const fallback = el('div', {class: 'panel flex flex-col gap-3', role: 'alert',
      'data-mock-route-error': err?.code || 'unavailable'},
      el('p', {class: 'text-sm text-ink-700'},
        context?.locale === 'uz' ? 'Mock sahifasi yuklanmadi.' : 'Could not load this Mock page.'));
    const retry = el('button', {type: 'button', class: 'btn-secondary',
      'data-mock-route-retry': ''}, context?.dict?.common?.retry || 'Retry');
    listen(retry, 'click', () => {
      void renderMockRouteForUrl(context, host, targetUrl);
    }, screenSignal);
    fallback.append(retry);
    host.replaceChildren(fallback);
  }
}
/**
 * Progressive enhancement entry point called from `modules/mocks/page.js`.
 * Registers same-pathname query navigation (`onNavigate`) and browser Back/Forward (`onHistory`)
 * with the Learners Area SPA router so all transitions use History API cleanly.
 */
export async function mountMockWorkspace(context, host) {
  const handleRouteUrlChange = nextUrl => {
    if (nextUrl.pathname !== '/app/mocks') return false;
    void renderMockRouteForUrl(context, host, nextUrl);
    return true;
  };

  context?.onNavigate?.(handleRouteUrlChange);
  context?.onHistory?.(handleRouteUrlChange);

  await renderMockRouteForUrl(context, host, context.url);
}

export function renderEnhancedCatalogue(context, host, catalog) {
  const L = labelsFor(context);
  const {signal} = context;

  const wrapper = el('div', {class: 'flex flex-col gap-4', 'data-mock-enhanced-catalogue': ''});
  const headerBanner = el('div', {class: 'panel flex flex-wrap items-center justify-between gap-2 border-gold/40'},
    el('span', {class: 'text-sm font-medium text-ink-900'}, L.weeklyBadge),
    el('span', {class: 'badge badge-gold', 'data-mock-weekly-slot': catalog.weeklySlot || ''}, catalog.weeklySlot || 'Asia/Tashkent'),
    el('p', {class: 'w-full text-xs text-ink-500'}, L.weeklyLimitNotice),
  );
  wrapper.append(headerBanner);

  const errorBanner = el('div', {role: 'alert', class: 'panel hidden border-band-bad/40 text-sm text-band-bad', 'data-mock-start-error': ''});
  wrapper.append(errorBanner);

  const testsList = el('div', {class: 'flex flex-col gap-3', 'data-mock-available-list': ''});
  for (const test of catalog.tests || []) {
    const isAvailable = test.status === 'available' && test.materialReady !== false;
    const statusLabel = test.materialReady === false
      ? L.unavailable
      : isAvailable
        ? L.available
        : L.scheduled;
    const badgeNode = el('span', {
      class: isAvailable ? 'badge badge-done' : 'badge badge-locked',
      'data-mock-test-status': test.materialReady === false ? 'unavailable' : test.status,
    }, statusLabel);

    let actionBtn = null;
    if (test.resumableAttemptId) {
      actionBtn = el('button', {
        type: 'button',
        class: 'btn-primary btn-sm',
        'data-mock-continue-btn': test.resumableAttemptId,
      }, L.continueMock);
      listen(actionBtn, 'click', () => {
        void navigateMockRoute(context, host, buildMockRouteUrl(test.resumableAttemptId, false));
      }, signal);
    } else if (isAvailable && test.canStart) {
      actionBtn = el('button', {
        type: 'button',
        class: 'btn-primary btn-sm',
        'data-mock-start-btn': test.id,
      }, L.startMock);
      listen(actionBtn, 'click', async () => {
        actionBtn.disabled = true;
        errorBanner.classList.add('hidden');
        try {
          const started = await api.request(`/api/mocks/${encodeURIComponent(test.id)}/attempts`, {
            method: 'POST',
            body: {},
            signal,
          });
          if (signal?.aborted) return;
          if (started?.attemptId) {
            await navigateMockRoute(context, host, buildMockRouteUrl(started.attemptId, false));
          }
        } catch (err) {
          if (signal?.aborted) return;
          actionBtn.disabled = false;
          errorBanner.textContent = err?.data?.error?.message || err?.message || L.weeklyLimitNotice;
          errorBanner.classList.remove('hidden');
        }
      }, signal);
    }

    const card = el('div', {class: 'panel flex flex-wrap items-center justify-between gap-4', 'data-mock-catalog-card': test.id},
      el('div', {class: 'flex flex-col gap-1'},
        el('h2', {class: 'font-display text-lg text-ink-900'}, test.title),
        el('p', {class: 'text-xs text-ink-500'},
          test.skill === 'full' ? 'Listening · Reading · Writing · Speaking' : test.skill)),
      el('div', {class: 'flex flex-col items-end gap-2'}, badgeNode, actionBtn),
    );
    testsList.append(card);
  }
  if (!testsList.childElementCount) {
    testsList.append(el('p', {class: 'panel text-sm text-ink-500', 'data-mock-no-published-tests': ''},
      context?.locale === 'uz'
        ? 'Hozircha rasmiy Mock testlari nashr qilinmagan. Test materiali e’lon qilingach boshlash tugmasi paydo bo‘ladi.'
        : 'No official Mock tests have been published yet. The Start button appears when a test with verified materials is available.'));
  }
  wrapper.append(testsList);

  if (Array.isArray(catalog.attempts) && catalog.attempts.length > 0) {
    const attemptsPanel = el('div', {class: 'panel flex flex-col gap-3', 'data-mock-previous-attempts': ''},
      el('h2', {class: 'font-display text-lg text-ink-900'}, context.dict?.mocks?.myAttempts || 'My previous attempts'));
    for (const att of catalog.attempts) {
      const sec = att.sections || {};
      const fmtBand = s => (sec[s]?.band != null ? Number(sec[s].band).toFixed(1) : '—');
      const summaryLine = `Listening ${fmtBand('listening')} · Reading ${fmtBand('reading')} · W ${fmtBand('writing')} · S ${fmtBand('speaking')}`;
      const statusText = att.estimatedBand != null
        ? `${L.overallBand} ${Number(att.estimatedBand).toFixed(1)}`
        : att.status === 'in_progress'
          ? L.inProgress
          : L.awaitingGrading;

      const btn = el('button', {
        type: 'button',
        class: 'btn-secondary btn-sm',
        'data-mock-open-attempt': att.id,
      }, att.status === 'in_progress' ? L.continueMock : L.viewResults);
      listen(btn, 'click', () => {
        const isResults = att.status !== 'in_progress';
        void navigateMockRoute(context, host, buildMockRouteUrl(att.id, isResults));
      }, signal);

      attemptsPanel.append(
        el('div', {class: 'flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3', 'data-mock-attempt-row': att.id},
          el('div', {class: 'flex flex-col gap-0.5'},
            el('span', {class: 'text-sm font-medium text-ink-900'}, att.title),
            el('span', {class: 'text-xs text-ink-500', 'data-mock-attempt-summary': att.id}, summaryLine)),
          el('div', {class: 'flex items-center gap-2'},
            el('span', {class: 'badge bg-paper-sunken text-ink-700', 'data-mock-attempt-badge': att.id}, statusText),
            btn),
        ),
      );
    }
    wrapper.append(attemptsPanel);
  }

  host.replaceChildren(wrapper);
}

export async function renderExamRunnerScreen(context, host, attemptId) {
  const L = labelsFor(context);
  const {signal} = context;

  const snapResp = await api.request(`/api/mocks/attempts/${encodeURIComponent(attemptId)}`, {signal, fresh: true});
  if (signal?.aborted || !snapResp?.ok) return;

  const attempt = snapResp.attempt;
  const serverOffsetMs = snapResp.serverNow ? (new Date(snapResp.serverNow).getTime() - Date.now()) : 0;

  const sections = attempt.sections || [];
  let activeIdx = sections.findIndex(s => s.status === 'in_progress');
  if(activeIdx<0){await navigateMockRoute(context,host,buildMockRouteUrl(attemptId,true));return;}

  let activeWritingTab = 'task1';
  const initialRevisions = {
    listening: (sections.find(s => s.skill === 'listening')?.draftRevision || 0),
    reading: (sections.find(s => s.skill === 'reading')?.draftRevision || 0),
    task1: (attempt.writingTasks?.find(t => t.taskType === 'task1')?.draftRevision || 0),
    task2: (attempt.writingTasks?.find(t => t.taskType === 'task2')?.draftRevision || 0),
  };
  const answersState = {
    listening: {...(sections.find(s => s.skill === 'listening')?.answers || {})},
    reading: {...(sections.find(s => s.skill === 'reading')?.answers || {})},
    task1: attempt.writingTasks?.find(t => t.taskType === 'task1')?.content || '',
    task2: attempt.writingTasks?.find(t => t.taskType === 'task2')?.content || '',
  };
  const speakingState = {};
  for (const sp of attempt.speakingParts || []) {
    speakingState[sp.questionId?sp.part+':'+sp.questionId:sp.part] = sp;
  }
  const activeSpeakingRecorders = new Map();
  const pendingSpeakingRecordings = new Map();
  const speakingPreviewUrls = new Map();

  const cleanupMediaResources = () => {
    for (const rec of activeSpeakingRecorders.values()) {
      try {
        rec.cancel();
      } catch {
        // ignore
      }
    }
    activeSpeakingRecorders.clear();
    for (const url of speakingPreviewUrls.values()) {
      try {
        URL.revokeObjectURL?.(url);
      } catch {
        // ignore
      }
    }
    speakingPreviewUrls.clear();
  };
  signal?.addEventListener('abort', cleanupMediaResources, {once: true});

  const syncChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`la-mock-${attemptId}`) : null;
  if (syncChannel) {
    signal?.addEventListener('abort', () => syncChannel.close(), {once: true});
  }

  const container = el('div', {class: 'flex flex-col gap-4', 'data-mock-runner': attemptId});
  const timerNode = el('div', {
    class: 'panel px-4 py-2 font-mono text-lg font-bold text-ink-900',
    'data-mock-timer': '',
    'aria-live': 'off',
  }, '00:00:00');
  const saveStatusWrapper = el('div', {class: 'flex items-center gap-2', 'data-mock-save-region': ''});
  const saveIndicator = el('span', {class: 'text-xs text-ink-500', 'data-mock-save-status': 'idle'}, '');
  const retrySaveBtn = el('button', {
    type: 'button',
    class: 'btn-secondary btn-sm hidden',
    'data-mock-save-retry': '',
  }, L.retrySave);
  saveStatusWrapper.append(saveIndicator, retrySaveBtn);

  const stageHost = el('div', {class: 'flex flex-col gap-4', 'data-mock-stage': ''});

  const autosave = createRevisionSafeAutosaveManager({
    attemptId,
    signal,
    initialRevisions,
    syncChannel,
    onStatusChange(st) {
      saveIndicator.setAttribute('data-mock-save-status', st.status);
      if (st.status === 'unsaved') {
        saveIndicator.textContent = L.unsaved;
        retrySaveBtn.classList.add('hidden');
      } else if (st.status === 'saving') {
        saveIndicator.textContent = L.saving;
        retrySaveBtn.classList.add('hidden');
      } else if (st.status === 'saved') {
        saveIndicator.textContent = L.saved;
        retrySaveBtn.classList.add('hidden');
      } else if (st.status === 'failed') {
        saveIndicator.textContent = st.error || L.saveFailed;
        retrySaveBtn.classList.remove('hidden');
      } else {
        saveIndicator.textContent = '';
        retrySaveBtn.classList.add('hidden');
      }
    },
  });

  listen(retrySaveBtn, 'click', () => {
    void autosave.retry();
  }, signal);

  if (syncChannel) {
    syncChannel.onmessage = ev => {
      const msg = ev?.data;
      if (!msg || msg.type !== 'draft_saved') return;
      autosave.applyRemoteUpdate(msg.key, msg.revision);
      if (msg.key === 'listening' || msg.key === 'reading') {
        if (msg.body?.answers && typeof msg.body.answers === 'object') {
          answersState[msg.key] = {...msg.body.answers};
        }
      } else if (msg.key === 'task1' || msg.key === 'task2') {
        if (typeof msg.body?.content === 'string') {
          answersState[msg.key] = msg.body.content;
        }
      }
    };
  }

  if (typeof window !== 'undefined') {
    listen(window, 'beforeunload', ev => {
      if (autosave.hasUnsavedChanges() || activeSpeakingRecorders.size > 0) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    }, signal);
  }

  const updateClock = () => {
    const currentSec = sections[activeIdx];
    if (!currentSec || currentSec.submittedAt) {
      timerNode.textContent = '00:00:00';
      return;
    }
    const nowServer = Date.now() + serverOffsetMs;
    const dl = currentSec.deadlineAt ? new Date(currentSec.deadlineAt).getTime() : (nowServer + (currentSec.remainingSeconds || 0) * 1000);
    const rem = Math.max(0, Math.floor((dl - nowServer) / 1000));
    timerNode.textContent = formatClock(rem);
  };
  updateClock();
  const clockInterval = setInterval(() => {
    if (signal?.aborted) {
      clearInterval(clockInterval);
      return;
    }
    updateClock();
  }, 1000);
  signal?.addEventListener('abort', () => clearInterval(clockInterval), {once: true});

  const listeningSection = sections.find(s => s.skill === 'listening');
  const listeningController = listeningSection
    ? createListeningPlaybackController({
        attemptId,
        audioUrl: listeningSection.material?.audioUrl || '',
        initialPlayback: listeningSection.playback || null,
        signal,
      })
    : null;

  function renderStage() {
    const activeFocusKey = typeof document !== 'undefined' ? document.activeElement?.getAttribute?.('data-focus-key') : null;
    const sec = sections[activeIdx];
    if (!sec) {
      void navigateMockRoute(context, host, buildMockRouteUrl(attemptId, true));
      return;
    }

    const navChips = el('div', {class: 'flex flex-wrap items-center gap-2', 'data-mock-section-tabs': ''},
      sections.map((s, idx) => {
        const isCurrent = idx === activeIdx;
        const isDone = Boolean(s.submittedAt);
        const btn = el('button', {
          type: 'button',
          class: `chip ${isCurrent ? 'chip-active' : isDone ? 'chip-done' : ''}`,
          disabled: isDone && idx !== activeIdx,
          'data-mock-section-tab': s.skill,
        }, `${s.position}. ${s.skill.toUpperCase()}`);
        listen(btn, 'click', async () => {
          if (!isDone && idx !== activeIdx) {
            try {
              await autosave.flushAll();
            } catch {
              return;
            }
            activeIdx = idx;
            updateClock();
            renderStage();
          }
        }, signal);
        return btn;
      }),
    );

    // TASK 5: Verify real published section material; fail closed if missing or incomplete
    const materialCheck = validateSectionMaterialForRunner(sec, attempt.writingTasks);
    if (!materialCheck.valid) {
      const retryBtn = el('button', {
        type: 'button',
        class: 'btn-secondary btn-sm self-start',
        'data-mock-retry-material': sec.skill,
      }, L.retryLoad);
      listen(retryBtn, 'click', () => {
        void renderMockRouteForUrl(context, host, context.url);
      }, signal);

      const unavailableCard = el('div', {
        role: 'alert',
        class: 'panel flex flex-col gap-3 border-band-bad/40',
        'data-mock-material-unavailable': sec.skill,
        'data-mock-material-error-code': materialCheck.code,
      },
        el('h2', {class: 'font-display text-lg text-ink-900'}, L.contentUnavailableTitle),
        el('p', {class: 'text-sm text-ink-700'}, materialCheck.message || L.contentUnavailableBody),
        retryBtn,
      );
      stageHost.replaceChildren(navChips, unavailableCard);
      return;
    }

    let bodyNode;
    if (sec.skill === 'listening' || sec.skill === 'reading') {
      const mat = sec.material || {};
      const questions = Array.isArray(mat.questions) ? mat.questions : [];
      const passages = Array.isArray(mat.passages) ? mat.passages : [];

      let audioWidget = null;
      if (sec.skill === 'listening' && listeningController) {
        const pbState = listeningController.getState();
        const audioEl = el('audio', {
          preload: 'auto',
          src: mat.audioUrl,
          class: 'hidden',
          'data-mock-audio-player': '',
        });
        let authorizedSec = Math.floor((pbState.positionMs || 0) / 1000);
        const statusLine = el('p', {
          class: 'text-xs font-medium text-ink-700',
          'data-mock-listening-status': pbState.status,
        }, pbState.status === 'completed'
          ? L.listeningCompleted
          : pbState.status === 'locked_other_tab'
            ? L.listeningOtherTab
            : pbState.status === 'interrupted'
              ? L.listeningNetRecovery
              : pbState.status === 'playing'
                ? L.listeningPlaying
                : L.examConditions);

        const playBtn = el('button', {
          type: 'button',
          class: 'btn-primary btn-sm self-start',
          disabled: pbState.status === 'completed' || pbState.status === 'playing',
          'data-mock-listening-play': '',
        }, pbState.status === 'completed'
          ? L.listeningCompleted
          : pbState.status === 'interrupted' || pbState.positionMs > 0
            ? L.resumeListeningAudio
            : L.startListeningAudio);

        // Enforce no user scrub/seek on the underlying audio element
        listen(audioEl, 'seeking', () => {
          if (Math.abs((audioEl.currentTime || 0) - authorizedSec) > 1.5) {
            try {
              audioEl.currentTime = authorizedSec;
            } catch {
              // ignore
            }
          }
        }, signal);

        listen(audioEl, 'timeupdate', () => {
          authorizedSec = Math.max(authorizedSec, Math.floor(audioEl.currentTime || 0));
        }, signal);

        listen(audioEl, 'stalled', () => {
          void listeningController.reportNetworkInterruption(Math.floor((audioEl.currentTime || authorizedSec) * 1000));
          statusLine.setAttribute('data-mock-listening-status', 'interrupted');
          statusLine.textContent = L.listeningNetRecovery;
          playBtn.disabled = false;
          playBtn.textContent = L.resumeListeningAudio;
        }, signal);

        listen(audioEl, 'error', () => {
          void listeningController.reportNetworkInterruption(Math.floor((audioEl.currentTime || authorizedSec) * 1000));
          statusLine.setAttribute('data-mock-listening-status', 'interrupted');
          statusLine.textContent = L.listeningNetRecovery;
          playBtn.disabled = false;
          playBtn.textContent = L.resumeListeningAudio;
        }, signal);

        listen(audioEl, 'ended', async () => {
          await listeningController.markCompleted(Math.floor((audioEl. duration || authorizedSec) * 1000));
          statusLine.setAttribute('data-mock-listening-status', 'completed');
          statusLine.textContent = L.listeningCompleted;
          playBtn.disabled = true;
          playBtn.textContent = L.listeningCompleted;
        }, signal);

        listen(playBtn, 'click', async () => {
          playBtn.disabled = true;
          try {
            const nextState = await listeningController.requestStartOrResume();
            authorizedSec = Math.floor((nextState.positionMs || 0) / 1000);
            try {
              if (authorizedSec > 0) {
                audioEl.currentTime = authorizedSec;
              }
            } catch {
              // ignore if metadata not loaded yet
            }
            statusLine.setAttribute('data-mock-listening-status', 'playing');
            statusLine.textContent = L.listeningPlaying;
            await audioEl.play?.();
          } catch (err) {
            const st = listeningController.getState();
            statusLine.setAttribute('data-mock-listening-status', st.status);
            statusLine.textContent = err?.message || L.listeningOtherTab;
            playBtn.disabled = st.status === 'completed';
          }
        }, signal);

        audioWidget = el('div', {class: 'flex flex-col gap-2', 'data-mock-listening-controls': ''},
          playBtn,
          statusLine,
          audioEl,
        );
      }

      const leftPane = el('div', {class: 'panel flex flex-col gap-3', 'data-mock-left-pane': sec.skill},
        el('h2', {class: 'font-display text-lg text-ink-900'},
          sec.skill === 'listening' ? L.audioPlayer : L.sectionMaterials),
        audioWidget,
        passages.length > 0
          ? el('div', {class: 'flex flex-col gap-3 max-h-[60vh] overflow-y-auto'},
              passages.map(p => el('article', {class: 'flex flex-col gap-1 border-b border-ink-100 pb-3'},
                el('h3', {class: 'font-display text-base text-ink-900'}, `Passage ${p.passageNo || ''}: ${p.title || ''}`),
                el('p', {class: 'body-text whitespace-pre-wrap text-sm'}, p.bodyText || ''))))
          : null,
        el('p', {class: 'text-xs text-ink-500', 'data-mock-exam-conditions': ''}, L.examConditions),
      );

      const qItems = questions.map((q, idx) => {
        const qid = String(q.id);
        const qNum = q.order || q.question_no || idx + 1;
        const fKey = `${sec.skill}-q-${qid}`;
        const inp = el('input', {
          type: 'text',
          class: 'input',
          value: answersState[sec.skill][qid] || '',
          placeholder: `${qNum}. Answer`,
          'aria-label': `Question ${qNum}`,
          'data-mock-question-input': qid,
          'data-focus-key': fKey,
          autocomplete: 'off',
          spellcheck: 'false',
        });
        listen(inp, 'input', () => {
          answersState[sec.skill][qid] = inp.value;
          void autosave.queueChange(sec.skill, {answers: {...answersState[sec.skill]}});
        }, signal);

        return el('div', {class: 'flex flex-col gap-1 border-b border-ink-100 pb-2', 'data-mock-question-row': qid},
          el('label', {class: 'text-sm font-medium text-ink-900'}, `${qNum}. ${q.question_text || q.questionText}`),
          inp,
        );
      });

      const rightPane = el('div', {class: 'panel flex flex-col gap-3 max-h-[70vh] overflow-y-auto', 'data-mock-questions-pane': sec.skill},
        el('h2', {class: 'font-display text-lg text-ink-900'}, `${L.questionsHeading} (1–${qItems.length})`),
        ...qItems,
      );

      bodyNode = el('div', {class: 'grid grid-cols-1 gap-4 lg:grid-cols-2'}, leftPane, rightPane);
    } else if (sec.skill === 'writing') {
      const task1Meta = attempt.writingTasks.find(t => t.taskType === 'task1');
      const task2Meta = attempt.writingTasks.find(t => t.taskType === 'task2');
      const currentMeta = activeWritingTab === 'task1' ? task1Meta : task2Meta;

      const tabBar = el('div', {class: 'flex gap-2', role: 'tablist'},
        ['task1', 'task2'].map(tKey => {
          const btn = el('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': String(activeWritingTab === tKey),
            class: `tab ${activeWritingTab === tKey ? 'tab-active' : ''}`,
            'data-mock-writing-tab': tKey,
          }, tKey === 'task1' ? L.task1Label : L.task2Label);
          listen(btn, 'click', () => {
            activeWritingTab = tKey;
            renderStage();
          }, signal);
          return btn;
        }),
      );

      const wordCountNode = el('span', {class: 'badge badge-gold', 'data-mock-word-count': activeWritingTab},
        `${L.wordsCount}: ${countWords(answersState[activeWritingTab])}`);

      const textarea = el('textarea', {
        class: 'input min-h-[320px] font-sans leading-relaxed',
        value: answersState[activeWritingTab],
        placeholder: L.yourEssayPlaceholder,
        'aria-label': activeWritingTab === 'task1' ? L.task1Label : L.task2Label,
        'data-mock-writing-editor': activeWritingTab,
        'data-focus-key': `writing-editor-${activeWritingTab}`,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
      });
      listen(textarea, 'input', () => {
        answersState[activeWritingTab] = textarea.value;
        wordCountNode.textContent = `${L.wordsCount}: ${countWords(textarea.value)}`;
        void autosave.queueChange(activeWritingTab, {
          taskType: activeWritingTab,
          content: textarea.value,
        });
      }, signal);

      const promptPane = el('div', {class: 'panel flex flex-col gap-3', 'data-mock-writing-prompt': activeWritingTab},
        el('h2', {class: 'font-display text-lg text-ink-900'}, activeWritingTab === 'task1' ? 'Writing Task 1' : 'Writing Task 2'),
        el('p', {class: 'body-text whitespace-pre-wrap text-sm'}, currentMeta.prompt || ''),
        currentMeta.mediaUrl
          ? el('img', {
              src: currentMeta.mediaUrl,
              alt: 'Task 1 visual diagram',
              class: 'max-w-full rounded-xl border border-ink-100 object-contain',
              'data-mock-task1-image': '',
            })
          : null,
        el('p', {class: 'text-xs text-ink-500'}, L.examConditions),
      );

      const editorPane = el('div', {class: 'panel flex flex-col gap-3'},
        el('div', {class: 'flex items-center justify-between'},
          el('span', {class: 'field-label'}, activeWritingTab.toUpperCase()),
          wordCountNode),
        textarea,
      );

      bodyNode = el('div', {class: 'flex flex-col gap-4'},
        tabBar,
        el('div', {class: 'grid grid-cols-1 gap-4 lg:grid-cols-2'}, promptPane, editorPane));
    } else {
      const matParts = sec.material.parts;

      const questionMode=attempt.speakingCaptureMode==='question';
      const recordings=questionMode?matParts.map((p,index)=>({partCode:p.part,partPrompts:[p],captureKey:p.part+':'+p.questionId,index})):['P1','P2','P3'].map(partCode=>({partCode,partPrompts:matParts.filter(p=>p.part===partCode),captureKey:partCode}));
      const partCards = recordings.map(({partCode,partPrompts,captureKey,index}) => {
        const existingRec = speakingState[captureKey];
        const activeRec = activeSpeakingRecorders.get(captureKey);
        const pendingUploadRec = pendingSpeakingRecordings.get(captureKey);
        const isFinalized = existingRec?.captureStatus === 'finalized';

        const statusBadge = el('span', {
          class: isFinalized ? 'badge badge-done' : 'badge badge-locked',
          'data-mock-speaking-status': captureKey,
        }, isFinalized ? L.recordedFinalized : activeRec ? L.recordingNow : partCode);

        const feedbackMsg = el('p', {
          class: 'text-xs text-ink-500',
          'data-mock-speaking-msg': captureKey,
        }, '');

        const recordBtn = el('button', {
          type: 'button',
          class: 'btn-primary btn-sm',
          disabled: isFinalized,
          'data-mock-speaking-record': captureKey,
        }, isFinalized
          ? L.recordedFinalized
          : activeRec
            ? L.stopRecording
            : `${L.recordPart} ${partCode}`);

        const retryUploadBtn = el('button', {
          type: 'button',
          class: `btn-secondary btn-sm ${pendingUploadRec && !isFinalized ? '' : 'hidden'}`,
          'data-mock-speaking-retry': captureKey,
        }, L.retryAudioUpload);

        const previewUrl = speakingPreviewUrls.get(captureKey)||(existingRec?.objectKey?'/api/resources/'+existingRec.objectKey:null);
        const replayAudio = previewUrl
          ? el('audio', {
              controls: true,
              src: previewUrl,
              class: 'mt-2 w-full',
              'aria-label': `${L.replayRecording} ${partCode}`,
              'data-mock-speaking-replay': captureKey,
            })
          : null;

        const performUploadAndFinalize = async recordedObj => {
          recordBtn.disabled = true;
          retryUploadBtn.classList.add('hidden');
          feedbackMsg.textContent = L.uploadingAudio;
          try {
            const finalized = await uploadSpeakingPartRecording({
              attemptId,
              part: partCode,
              recording: recordedObj,
              signal,
            });
            if (signal?.aborted) return;
            pendingSpeakingRecordings.delete(captureKey);
            speakingState[captureKey] = {
              part: partCode,
              ...(questionMode?{questionId:partPrompts[0].questionId}:{}),
              captureStatus: 'finalized',
              sha256: finalized.sha256,
              bytes: finalized.bytes,
              durationMs: finalized.durationMs,
              objectKey: finalized.objectKey,
            };
            renderStage();
          } catch (err) {
            if (signal?.aborted) return;
            recordBtn.disabled = false;
            retryUploadBtn.classList.remove('hidden');
            feedbackMsg.textContent = err?.message || 'Audio upload failed — retry';
          }
        };

        listen(retryUploadBtn, 'click', async () => {
          const pendingRec = pendingSpeakingRecordings.get(captureKey);
          if (pendingRec) {
            await performUploadAndFinalize(pendingRec);
          }
        }, signal);

        listen(recordBtn, 'click', async () => {
          if (isFinalized) return;
          const currentActive = activeSpeakingRecorders.get(captureKey);
          if(!currentActive&&activeSpeakingRecorders.size){feedbackMsg.textContent=context.locale==='uz'?'Avval joriy yozuvni yakunlang.':'Finish the current recording first.';return;}
          if (!currentActive) {
            // Start real MediaRecorder capture
            recordBtn.disabled = true;
            feedbackMsg.textContent = '';
            try {
              activeSpeakingRecorders.set(captureKey,{cancel(){}});
              const recorderInstance = await createMockSpeakingRecorder({
                signal,
                part: partCode,
                attemptId,
                questionIds: partPrompts.map(p => p.questionId),
                captureMode:questionMode?'question':'part',
                onDisconnect() {
                  activeSpeakingRecorders.delete(captureKey);
                  feedbackMsg.textContent = L.micDisconnected;
                  recordBtn.disabled = false;
                  recordBtn.textContent = `${L.recordPart} ${partCode}`;
                },
              });
              await recorderInstance.start();
              if (signal?.aborted) {
                recorderInstance.cancel();
                return;
              }
              activeSpeakingRecorders.set(captureKey, recorderInstance);
              recordBtn.disabled = false;
              recordBtn.textContent = L.stopRecording;
              statusBadge.textContent = L.recordingNow;
              feedbackMsg.textContent = L.recordingNow;
            } catch (err) {
              activeSpeakingRecorders.delete(captureKey);
              if (signal?.aborted) return;
              recordBtn.disabled = false;
              const code = err?.code || '';
              feedbackMsg.textContent = code === 'permission_denied'
                ? L.micPermissionDenied
                : code === 'device_disconnected'
                  ? L.micDisconnected
                  : code === 'unsupported_format'
                    ? L.micUnsupported
                    : (err?.message || L.micPermissionDenied);
            }
          } else {
            // Stop recording, create local preview, and upload real bytes
            activeSpeakingRecorders.delete(captureKey);
            recordBtn.disabled = true;
            try {
              const recordedObj = await currentActive.stop();
              if (signal?.aborted) return;
              const prevUrl = speakingPreviewUrls.get(captureKey);
              if (prevUrl) {
                try { URL.revokeObjectURL?.(prevUrl); } catch { /* ignore */ }
              }
              if (typeof URL?.createObjectURL === 'function') {
                speakingPreviewUrls.set(captureKey, URL.createObjectURL(recordedObj.blob));
              }
              pendingSpeakingRecordings.set(captureKey, recordedObj);
              await performUploadAndFinalize(recordedObj);
            } catch (err) {
              if (signal?.aborted) return;
              recordBtn.disabled = false;
              recordBtn.textContent = `${L.recordPart} ${partCode}`;
              const code = err?.code || '';
              feedbackMsg.textContent = code === 'device_disconnected'
                ? L.micDisconnected
                : code === 'empty_recording'
                  ? L.micEmpty
                  : (err?.message || L.micEmpty);
            }
          }
        }, signal);

        return el('div', {class: 'panel flex flex-col gap-2', 'data-mock-speaking-part': partCode, 'data-mock-speaking-question':questionMode?partPrompts[0].questionId:''},
          el('div', {class: 'flex items-center justify-between'},
            el('h3', {class: 'font-display text-base text-ink-900'}, `Speaking ${partCode}${questionMode?' · Q'+(index+1):''}`),
            statusBadge),
          ...partPrompts.flatMap(p => [el('p', {class: 'text-sm text-ink-700'}, p.promptText || p.topic || ''),...(p.cueCard?[el('p',{class:'whitespace-pre-line text-sm'},p.cueCard)]:[])]),
          replayAudio,
          questionMode?el('p',{class:'text-xs text-ink-500'},context.locale==='uz'?'Transcript mavjud bo‘lsa qurilmada olinadi; aniqligi tasdiqlanmagan. Asl audio saqlanadi.':'On-device transcript when supported; accuracy is unverified. Original audio is retained.'):null,
          el('div', {class: 'mt-2 flex flex-wrap items-center gap-2'}, recordBtn, retryUploadBtn, feedbackMsg),
        );
      });

      bodyNode = el('div', {class: 'flex flex-col gap-3', 'data-mock-speaking-stage': ''},
        el('div', {class: 'panel flex flex-col gap-1'},
          el('h2', {class: 'font-display text-lg text-ink-900'}, L.speakingTitle),
          el('p', {class: 'text-sm text-ink-500'}, L.speakingHint)),
        ...partCards,
      );
    }

    const submitBtn = el('button', {
      type: 'button',
      class: 'btn-primary',
      'data-mock-submit-section': sec.skill,
    }, activeIdx < sections.length - 1 ? L.nextPart : L.submitSection);

    listen(submitBtn, 'click', async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = L.submitting;
      try {
        // TASK 6: Flush and verify all pending autosaves before final section submission
        if (sec.skill === 'listening' || sec.skill === 'reading') {
          await autosave.flushAll([sec.skill]);
        } else if (sec.skill === 'writing') {
          await autosave.flushAll(['task1', 'task2']);
        } else if (sec.skill === 'speaking') {
          const requiredRecordings=attempt.speakingCaptureMode==='question'?sec.material.parts.map(p=>p.part+':'+p.questionId):['P1','P2','P3'];
          const allPartsFinalized = requiredRecordings.every(key => speakingState[key]?.captureStatus === 'finalized');
          if (!allPartsFinalized) {
            throw new MockRunnerError('speaking_incomplete', 'Please record and finalize Speaking Part 1, Part 2, and Part 3 before submitting.');
          }
        }

        const submitBody = (sec.skill === 'listening' || sec.skill === 'reading')
          ? {answers: answersState[sec.skill]}
          : sec.skill === 'writing'
            ? {tasks: {task1: answersState.task1, task2: answersState.task2}}
            : {};
        const res = await api.request(`/api/mocks/attempts/${encodeURIComponent(attemptId)}/sections/${encodeURIComponent(sec.skill)}/submit`, {
          method: 'POST',
          body: submitBody,
          signal,
        });
        if (signal?.aborted) return;
        sec.submittedAt = new Date().toISOString();
        sec.status = res?.status || 'completed';
        if (res?.allSectionsSubmitted || activeIdx >= sections.length - 1) {
          await navigateMockRoute(context, host, buildMockRouteUrl(attemptId, true));
          return;
        }
        activeIdx += 1;
        updateClock();
        renderStage();
      } catch (err) {
        if (!signal?.aborted) {
          submitBtn.disabled = false;
          submitBtn.textContent = activeIdx < sections.length - 1 ? L.nextPart : L.submitSection;
          saveIndicator.setAttribute('data-mock-save-status', 'failed');
          saveIndicator.textContent = err?.data?.error?.message || err?.message || 'Submission failed — retry';
        }
      }
    }, signal);

    stageHost.replaceChildren(
      navChips,
      bodyNode,
      el('div', {class: 'flex items-center justify-between pt-2'}, saveStatusWrapper, submitBtn),
    );

    if (activeFocusKey) {
      const target = stageHost.querySelector(`[data-focus-key="${activeFocusKey}"]`);
      if (target) {
        target.focus();
        try {
          if (typeof target.value === 'string' && target.setSelectionRange) {
            target.setSelectionRange(target.value.length, target.value.length);
          }
        } catch {
          // ignore non-text inputs
        }
      }
    }
  }

  const backToCatalogueBtn = el('button', {
    type: 'button',
    class: 'btn-secondary btn-sm self-start',
    'data-mock-back-catalogue': '',
  }, L.backToCatalogue);
  listen(backToCatalogueBtn, 'click', async () => {
    try {
      await autosave.flushAll();
    } catch {
      // Allow navigation back only after attempting flush
    }
    cleanupMediaResources();
    await navigateMockRoute(context, host, buildMockRouteUrl(null, false));
  }, signal);

  const topHeader = el('div', {class: 'flex flex-wrap items-center justify-between gap-3'},
    el('div', {class: 'flex flex-col gap-1'},
      backToCatalogueBtn,
      el('h1', {class: 'font-display text-2xl text-ink-900'}, attempt.title || 'IELTS Mock'),
      el('p', {class: 'text-sm text-ink-500'}, `${(attempt.track || 'Academic').toUpperCase()} · Full Timed Mock`)),
    timerNode,
  );

  container.append(topHeader, stageHost);
  host.replaceChildren(container);
  renderStage();
}

export async function renderResultsScreen(context, host, attemptId) {
  const L = labelsFor(context);
  const {signal} = context;

  const res = await api.request(`/api/mocks/attempts/${encodeURIComponent(attemptId)}/results`, {signal, fresh: true});
  if (signal?.aborted || !res?.ok) return;

  const backBtn = el('button', {
    type: 'button',
    class: 'btn-secondary btn-sm self-start',
    'data-mock-back-catalogue': '',
  }, L.backToCatalogue);
  listen(backBtn, 'click', () => {
    void navigateMockRoute(context, host, buildMockRouteUrl(null, false));
  }, signal);

  const overallText = res.overallBand != null ? Number(res.overallBand).toFixed(1) : L.pendingOverall;
  const summaryCard = el('div', {class: 'panel flex flex-wrap items-center justify-between gap-4', 'data-mock-result-summary': attemptId},
    el('div', {class: 'flex flex-col gap-1'},
      el('span', {class: 'badge badge-gold'}, res.label || L.estimateBadge),
      el('h2', {class: 'font-display text-xl text-ink-900'}, res.title || L.resultTitle),
      el('p', {class: 'text-xs text-ink-500'}, L.pendingSectionNote)),
    el('div', {class: 'flex flex-col items-end'},
      el('span', {class: 'text-xs text-ink-500'}, L.overallBand),
      el('span', {class: 'font-display text-3xl font-bold text-ink-900', 'data-mock-overall-band': ''}, overallText)),
  );

  const sectionCards = ['listening', 'reading', 'writing', 'speaking'].map(skill => {
    const s = res.sections?.[skill] || {skill, status: 'awaiting_grading', band: null};
    const bandStr = s.band != null ? `${L.bandLabel} ${Number(s.band).toFixed(1)}` : L.awaitingGrading;
    const rawStr = s.rawScore != null && s.scoreMax != null ? `${L.rawScoreLabel}: ${s.rawScore} / ${s.scoreMax}` : null;

    const detailsNodes = [];
    if (s.feedback && typeof s.feedback === 'object') {
      if (s.feedback.overall_feedback) {
        detailsNodes.push(
          el('div', {class: 'mt-2 rounded-xl bg-paper-sunken p-3 text-sm text-ink-700', 'data-mock-section-feedback': skill},
            el('strong', {class: 'block text-xs uppercase text-ink-500'}, L.feedbackHeading),
            el('p', {class: 'mt-1 whitespace-pre-wrap'}, s.feedback.overall_feedback)),
        );
      }
      if (s.feedback.tasks) {
        for (const tKey of ['task1', 'task2']) {
          const tData = s.feedback.tasks[tKey];
          if (!tData) continue;
          const crit = tData.criteria || {};
          const critPills = Object.entries(crit).map(([k, v]) =>
            el('span', {class: 'badge bg-paper-sunken text-ink-700'}, `${k.replace(/_/g, ' ')}: ${v ?? '—'}`),
          );
          const errRows = (tData.errors || []).map(errItem =>
            el('li', {class: 'text-xs text-ink-700'},
              el('span', {class: 'font-medium text-band-bad'}, `"${errItem.quote || ''}"`),
              ` → ${errItem.issue || ''}: `,
              el('span', {class: 'font-medium text-band-good'}, errItem.fix || '')),
          );
          detailsNodes.push(
            el('div', {class: 'mt-2 flex flex-col gap-2 border-t border-ink-100 pt-2', 'data-mock-writing-task-result': tKey},
              el('span', {class: 'text-xs font-semibold uppercase text-ink-700'}, tKey.toUpperCase()),
              el('div', {class: 'flex flex-wrap gap-1.5'}, ...critPills),
              tData.feedback ? el('p', {class: 'text-sm text-ink-700 whitespace-pre-wrap'}, tData.feedback) : null,
              errRows.length ? el('ul', {class: 'list-disc pl-4 space-y-1'}, ...errRows) : null),
          );
        }
      }
      if (Array.isArray(s.feedback.part_feedback) && s.feedback.part_feedback.length > 0) {
        detailsNodes.push(
          el('div', {class: 'mt-2 flex flex-col gap-1.5 border-t border-ink-100 pt-2', 'data-mock-speaking-parts-result': ''},
            el('strong', {class: 'text-xs uppercase text-ink-500'}, L.partFeedbackHeading),
            ...s.feedback.part_feedback.map(pf =>
              el('p', {class: 'text-xs text-ink-700'},
                `[${pf.part || ''} · ${pf.timestamp || '00:00:00'}] ${pf.feedback || ''} ${pf.explanation ? `(${pf.explanation})` : ''}`))),
        );
      }
    }

    return el('div', {class: 'panel flex flex-col gap-2', 'data-mock-result-section': skill},
      el('div', {class: 'flex items-center justify-between'},
        el('h3', {class: 'font-display text-lg capitalize text-ink-900'}, skill),
        el('div', {class: 'flex items-center gap-2'},
          rawStr ? el('span', {class: 'text-xs text-ink-500'}, rawStr) : null,
          el('span', {class: `badge ${s.band != null ? 'badge-done' : 'badge-locked'}`, 'data-mock-section-band': skill}, bandStr))),
      ...detailsNodes,
    );
  });

  const screen = el('div', {class: 'flex flex-col gap-4', 'data-mock-results-screen': attemptId},
    backBtn,
    summaryCard,
    el('div', {class: 'grid grid-cols-1 gap-4 md:grid-cols-2'}, ...sectionCards),
  );
  host.replaceChildren(screen);
}
