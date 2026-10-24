/** Grammar read and write DTOs for the native migration.
 * Read-only consumers of the proposed view boundary and the three Grammar POST routes.
 * Server enforces identity, publication and ownership. No client grading, no mastery
 * arithmetic, and no answer-bearing field is accepted before the server releases it. */
import {ApiError} from '../api-client.js';
import {uuid} from './listening-v7.js';
import {lessonDTO} from './listening-lessons-v10.js';
import {materialBlocksDTO} from './listening-activity-v8.js';

const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string';
const nullable = x => x === null || text(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const percent = x => Number.isFinite(x) && x >= 0 && x <= 100;
const bad = () => {throw new ApiError(502, 'invalid_grammar_view');};
const textList = x => Array.isArray(x) && x.every(text);
const ACTIVITIES = ['correct_it', 'translate_it', 'activate_it'];
const SKILL_AREAS = ['writing', 'speaking'];
/** Answer-bearing fields that must never reach the learner before the server releases them. */
const EXERCISE_FORBIDDEN = ['answer', 'answerKey', 'correctAnswer', 'correctOption', 'sampleAnswer', 'explanation', 'answers', 'payload'];

export function grammarLessonDTO(raw, id) {
  if (!obj(raw) || raw.kind !== 'lesson' || !obj(raw.detail)) bad();
  const detail = lessonDTO(raw.detail, id, 'grammar');
  const p = detail.progress;
  if (!obj(p) || !text(p.state) || p.state.length < 1 || p.state.length > 40) bad();
  if (p.completedAt !== null && !(text(p.completedAt) && Number.isFinite(Date.parse(p.completedAt)))) bad();
  return detail;
}

function mastery(m) {
  if (m === null) return null;
  if (!obj(m) || !percent(m.scorePercent) || !count(m.attempted) || !count(m.correct) || !count(m.sessions)
    || !count(m.sessionsRemaining) || typeof m.allActivitiesPractised !== 'boolean' || typeof m.mastered !== 'boolean'
    || !Array.isArray(m.byActivity) || m.byActivity.length !== ACTIVITIES.length) bad();
  const byActivity = m.byActivity.map(entry => {
    if (!obj(entry) || !ACTIVITIES.includes(entry.activity) || !count(entry.attempted) || !count(entry.correct) || !percent(entry.percent)) bad();
    return {activity: entry.activity, attempted: entry.attempted, correct: entry.correct, percent: entry.percent};
  });
  return {
    scorePercent: m.scorePercent, attempted: m.attempted, correct: m.correct, byActivity,
    sessions: m.sessions, sessionsRemaining: m.sessionsRemaining,
    allActivitiesPractised: m.allActivitiesPractised, mastered: m.mastered,
  };
}

function exercise(e, seen) {
  if (!obj(e) || !uuid(e.id) || seen.has(e.id) || Object.keys(e).some(k => EXERCISE_FORBIDDEN.includes(k))) bad();
  seen.add(e.id);
  if (!count(e.order) || !text(e.promptText) || !textList(e.options) || e.options.length < 2
    || typeof e.fromEssay !== 'boolean' || !nullable(e.translatePromptUz) || !textList(e.targetStructures)
    || !nullable(e.activationPrompt)) bad();
  return {
    id: e.id, order: e.order, promptText: e.promptText, options: e.options.slice(), fromEssay: e.fromEssay,
    translatePromptUz: e.translatePromptUz, targetStructures: e.targetStructures.slice(), activationPrompt: e.activationPrompt,
  };
}

/** Topic detail projection: `{kind:'topic', topic, exercises, mastery, masteryUnavailable, materials}`. */
export function grammarTopicDTO(raw, id) {
  if (!obj(raw) || raw.kind !== 'topic' || !uuid(id)) bad();
  const t = raw.topic;
  if (!obj(t) || t.id !== id || !text(t.title) || t.title.length < 1 || !text(t.explanation) || !SKILL_AREAS.includes(t.skillArea)) bad();
  if (!Array.isArray(raw.exercises)) bad();
  const seen = new Set();
  const exercises = raw.exercises.map(e => exercise(e, seen));
  if (typeof raw.masteryUnavailable !== 'boolean') bad();
  const m = mastery(raw.mastery ?? null);
  if (raw.masteryUnavailable && m !== null) bad();
  const materials = raw.materials;
  if (!obj(materials) || typeof materials.ok !== 'boolean') bad();
  let blocks = [];
  if (materials.ok) blocks = materialBlocksDTO(materials.blocks ?? []);
  return {
    topic: {id: t.id, title: t.title, explanation: t.explanation, skillArea: t.skillArea},
    exercises,
    mastery: m,
    masteryUnavailable: raw.masteryUnavailable,
    materials: {ok: materials.ok, blocks},
  };
}

/** Correct It submit: keyed by exerciseId. Correct options come only from this response. */
export function grammarSubmitDTO(p, exercises) {
  if (!obj(p) || !Array.isArray(p.results)) throw new ApiError(502, 'invalid_grammar_submit');
  const ids = new Set(exercises.map(e => e.id));
  const map = new Map();
  for (const r of p.results) {
    if (!obj(r) || !ids.has(r.exerciseId) || typeof r.isCorrect !== 'boolean' || !text(r.correctOption) || !text(r.explanation)) throw new ApiError(502, 'invalid_grammar_submit');
    map.set(r.exerciseId, {exerciseId: r.exerciseId, isCorrect: r.isCorrect, correctOption: r.correctOption, explanation: r.explanation});
  }
  return map;
}

/** Write Your Own: the evaluator's judgement, with the sample released only after the attempt is recorded. */
export function grammarProduceDTO(p) {
  if (!obj(p)) throw new ApiError(502, 'invalid_grammar_produce');
  return {
    verdict: text(p.verdict) ? p.verdict : null,
    checkedBy: p.checkedBy == null ? '' : String(p.checkedBy),
    sampleAnswer: p.sampleAnswer == null ? '' : String(p.sampleAnswer),
    explanation: p.explanation == null ? '' : String(p.explanation),
    issues: Array.isArray(p.issues) ? p.issues.filter(text) : [],
  };
}

/** Translate With It / Activate It: structure checklist plus the evaluator verdict. */
export function grammarPracticeDTO(p) {
  if (!obj(p) || !text(p.verdict)) throw new ApiError(502, 'invalid_grammar_practice');
  const s = obj(p.structures) ? p.structures : {};
  return {
    verdict: p.verdict,
    checkedBy: text(p.checkedBy) ? p.checkedBy : null,
    used: textList(s.used) ? s.used.slice() : [],
    missing: textList(s.missing) ? s.missing.slice() : [],
    sampleAnswer: p.sampleAnswer == null ? '' : String(p.sampleAnswer),
    explanation: p.explanation == null ? '' : String(p.explanation),
    issues: Array.isArray(p.issues) ? p.issues.filter(text) : [],
  };
}
