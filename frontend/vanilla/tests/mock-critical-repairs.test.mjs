import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.resolve(__dirname, '../modules/mocks/runner.js');

test('TASK 1: Real Speaking audio recording with MediaRecorder, real Blob SHA-256, permission/disconnect handling, and idempotent retry', async () => {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  assert.ok(!src.includes('SPEAKING-AUDIO-'), 'Fabricated SPEAKING-AUDIO string must never exist in runner.js');

  const mod = await import('../modules/mocks/runner.js');
  const rawAudio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('real-opus-speech-frames-part1-student-audio-payload-0123456789abcdef')]);
  const expectedSha = crypto.createHash('sha256').update(rawAudio).digest('hex');
  const blob = new Blob([rawAudio], {type: 'audio/webm'});
  const actualSha = await mod.sha256FromBlob(blob);
  assert.equal(actualSha, expectedSha, 'sha256FromBlob must compute exact SHA-256 of real Blob bytes');

  await assert.rejects(
    () => mod.sha256FromBlob(new Blob([], {type: 'audio/webm'})),
    err => err?.code === 'empty_recording',
  );

  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origMR = globalThis.MediaRecorder;
  let tracksStopped = 0;

  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          async getUserMedia() {
            const track = {
              addEventListener() {},
              removeEventListener() {},
              stop() { tracksStopped += 1; },
            };
            return {getTracks: () => [track], getAudioTracks: () => [track]};
          },
        },
      },
    });
    globalThis.MediaRecorder = class {
      static isTypeSupported(m) { return m.startsWith('audio/webm'); }
      constructor(stream, opts) {
        this.mimeType = opts?.mimeType || 'audio/webm';
        this.state = 'inactive';
        this.listeners = {};
      }
      addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
      start() {
        this.state = 'recording';
        for (const fn of this.listeners.dataavailable || []) {
          fn({data: new Blob([rawAudio], {type: this.mimeType})});
        }
      }
      stop() {
        this.state = 'inactive';
        for (const fn of this.listeners.stop || []) fn();
      }
    };

    const rec = await mod.createMockSpeakingRecorder({
      part: 'P1',
      attemptId: '8f4c0000-0000-4000-8000-000000000001',
      questionIds: ['q-p1-1'],
    });
    await rec.start();
    const recorded = await rec.stop();
    assert.equal(recorded.sha256, expectedSha);
    assert.equal(recorded.bytes, rawAudio.byteLength);
    assert.equal(tracksStopped, 1);

    // Verify 3-step upload (Intent -> PUT raw bytes -> Finalize) and retry without duplicate intents
    let putAttempts = 0;
    let intentAttempts = 0;
    const fakeFetcher = async (url, init = {}) => {
      if (url.endsWith('/speaking/upload-intent')) {
        intentAttempts += 1;
        return new Response(JSON.stringify({
          ok: true,
          uploadId: 'u-101',
          objectKey: 'speaking/attempts/8f4c0000-0000-4000-8000-000000000001/audio/p1/u-101.webm',
          mimeType: 'audio/webm',
        }), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      if (url.endsWith('/speaking/uploads/u-101')) {
        putAttempts += 1;
        if (putAttempts === 1) {
          return new Response(JSON.stringify({error: {code: 'network_error', message: 'Temporary drop'}}), {status: 503, headers: {'Content-Type': 'application/json'}});
        }
        const uploaded = new Uint8Array(init.body);
        assert.equal(uploaded.byteLength, rawAudio.byteLength);
        return new Response(JSON.stringify({ok: true, uploadId: 'u-101', bytes: uploaded.byteLength, sha256: expectedSha}), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      if (url.endsWith('/speaking/upload-finalize')) {
        return new Response(JSON.stringify({
          ok: true,
          part: 'P1',
          objectKey: 'speaking/attempts/8f4c0000-0000-4000-8000-000000000001/audio/p1/u-101.webm',
          bytes: rawAudio.byteLength,
          durationMs: recorded.durationMs,
          sha256: expectedSha,
          captureStatus: 'finalized',
        }), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      throw new Error('Unexpected fetch: ' + url);
    };

    await assert.rejects(() => mod.uploadSpeakingPartRecording({
      attemptId: recorded.attemptId,
      part: 'P1',
      recording: recorded,
      fetcher: fakeFetcher,
    }));
    const fin = await mod.uploadSpeakingPartRecording({
      attemptId: recorded.attemptId,
      part: 'P1',
      recording: recorded,
      fetcher: fakeFetcher,
    });
    assert.equal(fin.captureStatus, 'finalized');
    assert.equal(intentAttempts, 1, 'Retry must reuse the upload intent rather than creating duplicates');
    assert.equal(putAttempts, 2);
  } finally {
    globalThis.MediaRecorder = origMR;
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav);
  }
});

test('TASK 3: SPA navigation integration uses context.navigate, registers onNavigate/onHistory for Back/Forward, and preserves URL state', async () => {
  const mod = await import('../modules/mocks/runner.js');
  assert.equal(mod.buildMockRouteUrl(), '/app/mocks');
  assert.equal(mod.buildMockRouteUrl('att-123', false), '/app/mocks?attempt=att-123');
  assert.equal(mod.buildMockRouteUrl('att-123', true), '/app/mocks?attempt=att-123&results=1');

  const navigated = [];
  let registeredNavigateHandler = null;
  let registeredHistoryHandler = null;

  const fakeContext = {
    url: new URL('https://learnersarea.local/app/mocks'),
    signal: new AbortController().signal,
    navigate: async (target, opts) => {
      navigated.push({target, opts});
    },
    onNavigate(fn) { registeredNavigateHandler = fn; },
    onHistory(fn) { registeredHistoryHandler = fn; },
  };

  await mod.navigateMockRoute(fakeContext, {}, '/app/mocks?attempt=att-123');
  assert.equal(navigated.length, 1);
  assert.equal(navigated[0].target, '/app/mocks?attempt=att-123');

  const fakeHost = {replaceChildren() {}};
  await mod.mountMockWorkspace(fakeContext, fakeHost);
  assert.equal(typeof registeredNavigateHandler, 'function', 'mountMockWorkspace must register context.onNavigate');
  assert.equal(typeof registeredHistoryHandler, 'function', 'mountMockWorkspace must register context.onHistory for browser Back/Forward');
  assert.equal(registeredNavigateHandler(new URL('https://learnersarea.local/app/dashboard')), false, 'Non-mock routes must be delegated back to router');
});

test('TASK 4: Listening single-play controller enforces single play, blocks second tab and post-completion replay, and recovers from network interruption', async () => {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  // Verify Listening audio player does not enable unrestricted controls: true
  const listeningAudioBlock = src.slice(src.indexOf('let audioWidget = null;'), src.indexOf('const leftPane = el('));
  assert.ok(!listeningAudioBlock.includes('controls: true'), 'Listening exam audio element must not expose unrestricted controls: true');

  const mod = await import('../modules/mocks/runner.js');
  let serverState = {
    status: 'not_started',
    activeTabId: null,
    positionMs: 0,
    completedAt: null,
  };

  const fakeApiRequest = async (path, opts) => {
    const {action, tabId, positionMs} = opts.body;
    if (serverState.status === 'completed') {
      const err = new Error('Replay forbidden');
      err.status = 409;
      err.data = {error: {code: 'listening_replay_forbidden', message: 'Already played once'}};
      throw err;
    }
    if (serverState.status === 'playing' && serverState.activeTabId && serverState.activeTabId !== tabId) {
      const err = new Error('Playing in other tab');
      err.status = 409;
      err.data = {error: {code: 'listening_already_playing_in_other_tab', message: 'Active in another tab'}};
      throw err;
    }
    if (action === 'start' || action === 'resume' || action === 'heartbeat') {
      serverState.status = 'playing';
      serverState.activeTabId = tabId;
      serverState.positionMs = Math.max(serverState.positionMs, positionMs);
    } else if (action === 'interrupt') {
      serverState.status = 'interrupted';
      serverState.positionMs = Math.max(serverState.positionMs, positionMs);
    } else if (action === 'complete') {
      serverState.status = 'completed';
      serverState.positionMs = Math.max(serverState.positionMs, positionMs);
      serverState.completedAt = '2026-10-31T08:00:00Z';
    }
    return {ok: true, playback: {...serverState}};
  };

  const tabA = mod.createListeningPlaybackController({
    attemptId: 'att-1',
    tabId: 'tab-A',
    audioUrl: '/api/resources/listening/mock1.mp3',
    apiRequest: fakeApiRequest,
  });
  const tabB = mod.createListeningPlaybackController({
    attemptId: 'att-1',
    tabId: 'tab-B',
    audioUrl: '/api/resources/listening/mock1.mp3',
    apiRequest: fakeApiRequest,
  });

  await tabA.requestStartOrResume();
  await tabA.reportProgress(60000);
  assert.equal(tabA.getState().positionMs, 60000);

  // Tab B cannot start playback while Tab A is playing
  await assert.rejects(
    () => tabB.requestStartOrResume(),
    err => err?.code === 'listening_already_playing_in_other_tab',
  );
  assert.equal(tabB.getState().status, 'locked_other_tab');

  // Network interruption in Tab A preserves 60000ms and allows legitimate recovery
  await tabA.reportNetworkInterruption(65000);
  assert.equal(tabA.getState().status, 'interrupted');
  const resumed = await tabA.requestStartOrResume();
  assert.equal(resumed.status, 'playing');
  assert.equal(resumed.positionMs, 65000);

  // Complete playback -> subsequent replay in Tab A (or after reload) is rejected
  await tabA.markCompleted(1800000);
  assert.equal(tabA.getState().status, 'completed');
  await assert.rejects(
    () => tabA.requestStartOrResume(),
    err => err?.code === 'listening_replay_forbidden',
  );
});

test('TASK 5: Fabricated 40-question fallback is removed and validateSectionMaterialForRunner fails closed on missing content', async () => {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  assert.ok(!src.includes('Array.from({length: 40}'), 'Synthetic 40-question placeholder generator must be removed');

  const mod = await import('../modules/mocks/runner.js');

  // Missing Listening audio fails closed
  const badListeningNoAudio = mod.validateSectionMaterialForRunner({
    skill: 'listening',
    questionCount: 40,
    material: {audioUrl: '', questions: Array.from({length: 40}, (_, i) => ({id: `q${i + 1}`, question_text: `Real Q${i + 1}`}))},
  });
  assert.equal(badListeningNoAudio.valid, false);
  assert.equal(badListeningNoAudio.code, 'missing_listening_audio');

  // Incomplete question count fails closed
  const badReadingCount = mod.validateSectionMaterialForRunner({
    skill: 'reading',
    questionCount: 40,
    material: {
      passages: [{id: 'p1', passageNo: 1, title: 'Passage 1', bodyText: 'Real passage text'}],
      questions: [{id: 'q1', question_text: 'Only 1 question'}],
    },
  });
  assert.equal(badReadingCount.valid, false);
  assert.equal(badReadingCount.code, 'invalid_reading_questions');

  // Valid 40-question Reading section passes
  const goodReading = mod.validateSectionMaterialForRunner({
    skill: 'reading',
    questionCount: 40,
    material: {
      passages: [{id: 'p1', passageNo: 1, title: 'Passage 1', bodyText: 'Real passage text'}],
      questions: Array.from({length: 40}, (_, i) => ({id: `q${i + 1}`, question_text: `Real Question ${i + 1}`})),
    },
  });
  assert.equal(goodReading.valid, true);

  // Missing Writing prompts fails closed
  assert.equal(mod.validateSectionMaterialForRunner({skill: 'writing'}, []).valid, false);
  assert.equal(
    mod.validateSectionMaterialForRunner({skill: 'writing'}, [
      {taskType: 'task1', prompt: 'Describe the chart.'},
      {taskType: 'task2', prompt: 'Discuss both views.'},
    ]).valid,
    true,
  );
});

test('TASK 6: Revision-safe autosave tracks Unsaved/Saving/Saved/Failed, never claims Saved on failure, ignores stale responses, and flushes before submit', async () => {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  assert.ok(!src.includes('Offline — queued locally, will sync automatically'), 'Unsupported offline queue claim must be removed');

  const mod = await import('../modules/mocks/runner.js');
  const observedStates = [];
  let shouldFail = true;

  const manager = mod.createRevisionSafeAutosaveManager({
    attemptId: 'att-autosave-1',
    initialRevisions: {task1: 0},
    onStatusChange(st) {
      observedStates.push(st.status);
    },
    apiRequest: async (path, opts) => {
      if (shouldFail) {
        throw new Error('Network disconnected');
      }
      return {ok: true, revision: opts.body.revision, stale: false};
    },
  });

  // 1. Failed request must transition unsaved -> saving -> failed, NEVER 'saved'
  const ok1 = await manager.queueChange('task1', {taskType: 'task1', content: 'First draft paragraph.'});
  assert.equal(ok1, false);
  assert.equal(manager.getState('task1').status, 'failed');
  assert.equal(manager.hasUnsavedChanges(), true);
  assert.ok(!observedStates.includes('saved'), 'Failed save must never emit saved status');

  // 2. Retry succeeds and transitions to 'saved' only after server confirmation
  shouldFail = false;
  const okRetry = await manager.retry('task1');
  assert.equal(okRetry, true);
  assert.equal(manager.getState('task1').status, 'saved');
  assert.equal(manager.getState('task1').ackedRevision, 1);
  assert.equal(manager.hasUnsavedChanges(), false);

  // 3. Rapid typing / out-of-order responses preserve latest revision and flushAll() resolves cleanly
  let resolvers = [];
  const concurrentManager = mod.createRevisionSafeAutosaveManager({
    attemptId: 'att-autosave-2',
    initialRevisions: {reading: 0},
    apiRequest: (path, opts) => new Promise(resolve => {
      resolvers.push(() => resolve({ok: true, revision: opts.body.revision, stale: false}));
    }),
  });

  const pFirst = concurrentManager.queueChange('reading', {answers: {q1: 'A'}});
  const pSecond = concurrentManager.queueChange('reading', {answers: {q1: 'A', q2: 'B'}});
  assert.equal(concurrentManager.getState('reading').localRevision, 2);

  // Resolve in-flight requests
  while (resolvers.length > 0) {
    const r = resolvers.shift();
    r();
    await new Promise(res => setTimeout(res, 5));
  }
  await Promise.all([pFirst, pSecond]);
  await concurrentManager.flushAll(['reading']);
  assert.equal(concurrentManager.getState('reading').status, 'saved');
  assert.equal(concurrentManager.getState('reading').ackedRevision, 2);
});


test('REGRESSION: stale:true with ok:true never shows Saved, preserves draft, and retries above server revision', async () => {
  const mod = await import('../modules/mocks/runner.js');
  for (const key of ['reading', 'task1']) {
    const statuses = [], requests = [];
    const payload = key === 'reading' ? {answers: {q1: 'My answer'}} : {taskType: 'task1', content: 'My latest essay text'};
    const manager = mod.createRevisionSafeAutosaveManager({
      attemptId: 'stale-ack-regression',
      initialRevisions: {[key]: 0},
      onStatusChange: st => statuses.push(st.status),
      apiRequest: async (_path, opts) => {
        requests.push(opts.body);
        if (requests.length === 1) return {ok: true, stale: true, revision: 7};
        return {ok: true, stale: false, revision: opts.body.revision};
      },
    });
    const first = await manager.queueChange(key, payload);
    assert.equal(first, false, `${key}: stale response must not count as save`);
    assert.equal(manager.getState(key).status, 'failed');
    assert.equal(manager.hasUnsavedChanges(), true);
    assert.equal(manager.getState(key).ackedRevision, 7);
    assert.equal(manager.getState(key).localRevision, 8);
    assert.equal(statuses.includes('saved'), false);
    assert.equal(requests.length, 1, 'No silent overwrite after revision conflict');
    const retried = await manager.retry(key);
    assert.equal(retried, true);
    assert.equal(requests[1].revision, 8);
    assert.deepEqual({...requests[1], revision: undefined}, {...requests[0], revision: undefined});
    assert.equal(manager.getState(key).status, 'saved');
    assert.equal(manager.hasUnsavedChanges(), false);
  }
});

test('REGRESSION: missing or wrong revision is not a valid successful server acknowledgement', async () => {
  const mod = await import('../modules/mocks/runner.js');
  for (const ack of [{ok:true, stale:false, revision:0}, {ok:true, stale:false}]) {
    const statuses = [];
    const manager = mod.createRevisionSafeAutosaveManager({
      attemptId: 'invalid-ack-regression',
      onStatusChange: st => statuses.push(st.status),
      apiRequest: async () => ack,
    });
    assert.equal(await manager.queueChange('reading', {answers:{q1:'current'}}), false);
    assert.equal(manager.getState('reading').status,'failed');
    assert.equal(manager.hasUnsavedChanges(),true);
    assert.equal(statuses.includes('saved'),false);
  }
});

test('REGRESSION: late stale response cannot reverse a newer confirmed save', async () => {
  const mod = await import('../modules/mocks/runner.js');
  const resolvers = new Map();
  const statuses = [];
  const manager = mod.createRevisionSafeAutosaveManager({
    attemptId: 'out-of-order-regression',
    onStatusChange: st => statuses.push(st.status),
    apiRequest: (_path, opts) => new Promise(resolve => resolvers.set(opts.body.revision, resolve)),
  });
  const oldRequest = manager.queueChange('reading', {answers:{q1:'older'}});
  const newRequest = manager.queueChange('reading', {answers:{q1:'newer'}});
  resolvers.get(2)({ok:true, revision:2, stale:false});
  assert.equal(await newRequest, true);
  assert.equal(manager.getState('reading').status,'saved');
  resolvers.get(1)({ok:true, revision:2, stale:true});
  assert.equal(await oldRequest,true);
  assert.equal(manager.getState('reading').status,'saved');
  assert.equal(manager.hasUnsavedChanges(),false);
});
