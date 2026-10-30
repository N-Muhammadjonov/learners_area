import {test} from 'node:test';
import assert from 'node:assert/strict';
import {grammarTopicDTO, grammarSubmitDTO, grammarProduceDTO, grammarPracticeDTO, grammarLessonDTO} from '../js/adapters/grammar-v48.js';
import {apiErrorMessage} from '../js/api-error-message.js';
import en from '../js/i18n/en.js';

const T = '00000000-0000-4000-8000-0000000000e1';
const E1 = '00000000-0000-4000-8000-0000000000f1';
const E2 = '00000000-0000-4000-8000-0000000000f2';
const L = '00000000-0000-4000-8000-0000000000c1';
const B = '00000000-0000-4000-8000-0000000000b1';
const M = {scorePercent: 60, attempted: 4, correct: 3, sessions: 1, sessionsRemaining: 2, allActivitiesPractised: false, mastered: false,
  byActivity: [{activity: 'correct_it', attempted: 2, correct: 2, percent: 100}, {activity: 'translate_it', attempted: 2, correct: 1, percent: 50}, {activity: 'activate_it', attempted: 0, correct: 0, percent: 0}]};
const exercise = (over = {}) => ({id: E1, order: 1, promptText: 'She ___ gone.', options: ['has', 'have'], fromEssay: false,
  translatePromptUz: null, targetStructures: [], activationPrompt: null, ...over});
const topic = (over = {}) => ({kind: 'topic', topic: {id: T, title: 'Present Perfect', explanation: 'Explain.', skillArea: 'writing'},
  exercises: [exercise()], mastery: M, masteryUnavailable: false, materials: {ok: true, blocks: []}, ...over});

test('topic DTO accepts a valid server projection and keeps mastery as the server computed it', () => {
  const d = grammarTopicDTO(topic(), T);
  assert.equal(d.topic.title, 'Present Perfect');
  assert.deepEqual(d.mastery, M);
  assert.equal(d.exercises[0].fromEssay, false);
});

test('topic DTO refuses any exercise that carries an answer before release', () => {
  for (const key of ['correctOption', 'answerKey', 'sampleAnswer', 'explanation', 'answer']) {
    const leaked = {...exercise(), [key]: 'has'};
    assert.throws(() => grammarTopicDTO(topic({exercises: [leaked]}), T), {status: 502});
  }
});

test('topic DTO refuses mastery shown while unavailable and a foreign topic id', () => {
  assert.throws(() => grammarTopicDTO(topic({masteryUnavailable: true}), T), {status: 502});
  assert.throws(() => grammarTopicDTO(topic(), '00000000-0000-4000-8000-0000000000aa'), {status: 502});
});

test('topic DTO keeps the materials failure as a flag, not a fake block list', () => {
  const d = grammarTopicDTO(topic({materials: {ok: false}}), T);
  assert.equal(d.materials.ok, false);
  assert.deepEqual(d.materials.blocks, []);
});

test('submit results are keyed by exercise and only exist after the server responds', () => {
  const exercises = [{id: E1}, {id: E2}];
  const map = grammarSubmitDTO({ok: true, results: [{exerciseId: E1, isCorrect: true, correctOption: 'has', explanation: 'ok'}]}, exercises);
  assert.equal(map.get(E1).correctOption, 'has');
  assert.equal(map.has(E2), false);
  assert.throws(() => grammarSubmitDTO({ok: true}, exercises), {status: 502});
  assert.throws(() => grammarSubmitDTO({ok: true, results: [{exerciseId: 'x', isCorrect: true, correctOption: 'a', explanation: 'b'}]}, exercises), {status: 502});
});

test('produce and practice DTOs carry the verdict, checklist and evaluator without inventing values', () => {
  const p = grammarProduceDTO({verdict: 'correct', checkedBy: 'GrammarEvaluationService', sampleAnswer: 's', explanation: 'e', issues: ['i', 3]});
  assert.deepEqual(p, {verdict: 'correct', checkedBy: 'GrammarEvaluationService', sampleAnswer: 's', explanation: 'e', issues: ['i']});
  const q = grammarPracticeDTO({verdict: 'partial', checkedBy: null, structures: {used: ['has'], missing: ['V3']}, sampleAnswer: 's', explanation: 'e'});
  assert.deepEqual(q.used, ['has']);
  assert.deepEqual(q.missing, ['V3']);
  assert.equal(q.checkedBy, null);
  assert.throws(() => grammarPracticeDTO({checkedBy: 'x'}), {status: 502});
});

test('lesson DTO requires grammar learning area and a progress object', () => {
  const detail = {lesson: {id: L, title: 't', summary: null, estimatedMinutes: null, learningArea: 'grammar'}, note: '', teacherNotes: null,
    teacherNotesSource: null, blocks: [], mediaUrl: null, media: null, progress: {state: 'available', completedAt: null}};
  assert.equal(grammarLessonDTO({kind: 'lesson', detail}, L).lesson.id, L);
  assert.throws(() => grammarLessonDTO({kind: 'lesson', detail: {...detail, lesson: {...detail.lesson, learningArea: 'listening'}}}, L), {status: 502});
  assert.throws(() => grammarLessonDTO({kind: 'lesson', detail: {...detail, progress: undefined}}, L), {status: 502});
});

test('error mapping follows the original apiErrorMessage order and never shows a raw code', () => {
  assert.equal(apiErrorMessage('forbidden', 403, en), en.apiErrors.forbidden);
  assert.equal(apiErrorMessage({code: 'not_found'}, 404, en), en.apiErrors.notFound);
  assert.equal(apiErrorMessage('', 429, en), en.apiErrors.rateLimited);
  assert.equal(apiErrorMessage('invalid_input', 400, en), en.apiErrors.invalid);
  assert.equal(apiErrorMessage('evaluation_failed', 502, en), en.apiErrors.generic);
  assert.equal(apiErrorMessage('x', 500, en, {x: 'custom'}), 'custom');
});
