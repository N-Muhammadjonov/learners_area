import {ApiError} from '../api-client.js';
/** PROPOSED My Progress projections (V54), keyed by route `/app/progress` + region. They mirror the
 * original server outputs of getProgressData, getActivityStreak, getProgressTrends and getMockOverview
 * with no browser-side scoring. Every null means "unavailable", never zero. Validation is strict and
 * refuses source material (snapshots, questions, answers) that a progress view must never carry. */
const bad = () => { throw new ApiError(502, 'invalid_progress_adapter'); };
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length > 0;
const number = x => typeof x === 'number' && Number.isFinite(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const nullable = (x, check) => x === null || check(x);
const band = x => number(x) && x >= 0 && x <= 9;
const percent = x => Number.isSafeInteger(x) && x >= 0 && x <= 100;
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const instant = x => {
  if (x == null) return true;
  if (!(typeof x === 'string' || x instanceof Date)) return false;
  return Number.isFinite(new Date(x).getTime());
};
const toDate = x => (x == null ? null : new Date(x));
const SKILLS = ['full', 'listening', 'reading', 'writing', 'speaking'];
const STATES = ['new', 'learning', 'review', 'known', 'mastered', 'activated'];
const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];
const REGIONS = [
  'progress-reading', 'progress-listening', 'progress-speaking', 'progress-writing-submissions',
  'progress-writing-evaluation', 'progress-vocabulary', 'progress-vocabulary-due',
  'progress-lesson-catalogue', 'progress-lesson-state', 'progress-assignments', 'progress-mocks',
];

function skillStats(x) {
  if (x === null) return null;
  if (!object(x) || !count(x.attempts) || !count(x.submitted) || !count(x.score) || !count(x.total)) bad();
  if (!nullable(x.accuracy, percent)) bad();
  return {attempts: x.attempts, submitted: x.submitted, score: x.score, total: x.total, accuracy: x.accuracy};
}

/** Core skills, vocabulary, course and mock totals. Each section can fail alone (see unavailableRegions). */
export function progressSummaryDTO(d) {
  if (!object(d)) bad();
  for (const k of ['reading', 'listening', 'speaking', 'writing', 'vocabulary', 'lessons', 'assignments', 'mocks', 'unavailableRegions']) if (!(k in d)) bad();
  if (!Array.isArray(d.unavailableRegions) || d.unavailableRegions.some(r => !REGIONS.includes(r)) || new Set(d.unavailableRegions).size !== d.unavailableRegions.length) bad();
  const speaking = d.speaking;
  if (speaking !== null && (!object(speaking) || !count(speaking.attempts) || !count(speaking.submitted) || !count(speaking.transcribed))) bad();
  const w = d.writing;
  if (!object(w) || !nullable(w.submissions, count) || !nullable(w.latestBand, band) || !instant(w.latestEvaluationAt) || !instant(w.lastSubmittedAt) || typeof w.evaluationUnavailable !== 'boolean') bad();
  let vocabulary = null;
  if (d.vocabulary !== null) {
    const v = d.vocabulary;
    if (!object(v) || !count(v.total) || !nullable(v.due, count) || !object(v.byState) || STATES.some(s => !count(v.byState[s]))) bad();
    vocabulary = {total: v.total, due: v.due, byState: Object.fromEntries(STATES.map(s => [s, v.byState[s]]))};
  }
  const l = d.lessons;
  if (!object(l) || !nullable(l.total, count) || !nullable(l.open, count) || !nullable(l.inProgress, count) || !nullable(l.completed, count)) bad();
  let assignments = null;
  if (d.assignments !== null) {
    const a = d.assignments;
    if (!object(a) || !count(a.total) || !count(a.open) || !count(a.completed)) bad();
    assignments = {total: a.total, open: a.open, completed: a.completed};
  }
  let mocks = null;
  if (d.mocks !== null) {
    const m = d.mocks;
    if (!object(m) || !count(m.attempts) || !count(m.finished) || !nullable(m.bestBand, band)) bad();
    mocks = {attempts: m.attempts, finished: m.finished, bestBand: m.bestBand};
  }
  return {
    reading: skillStats(d.reading),
    listening: skillStats(d.listening),
    speaking: speaking === null ? null : {attempts: speaking.attempts, submitted: speaking.submitted, transcribed: speaking.transcribed},
    writing: {submissions: w.submissions, latestBand: w.latestBand, latestEvaluationAt: toDate(w.latestEvaluationAt), lastSubmittedAt: toDate(w.lastSubmittedAt), evaluationUnavailable: w.evaluationUnavailable},
    vocabulary,
    lessons: {total: l.total, open: l.open, inProgress: l.inProgress, completed: l.completed},
    assignments,
    mocks,
    unavailableRegions: [...d.unavailableRegions],
  };
}

/** Learner activity streak in the centre's timezone. `null` is unavailable, not zero. */
export function progressStreakDTO(d) {
  if (!object(d) || !nullable(d.streak, count)) bad();
  return {streak: d.streak};
}

function weekSeries(rows, max) {
  if (rows === null) return null;
  if (!Array.isArray(rows) || rows.length > 12) bad();
  return rows.map(r => {
    if (!object(r) || !day(r.weekStart) || !count(r.count) || !nullable(r.value, max === 100 ? percent : band)) bad();
    return {weekStart: r.weekStart, value: r.value, count: r.count};
  });
}

/** Weekly and heatmap series exactly as getProgressTrends shapes them (empty weeks stay null). */
export function progressTrendsDTO(d) {
  if (!object(d)) bad();
  for (const k of ['reading', 'listening', 'writing', 'speaking', 'heatmap', 'retention']) if (!(k in d)) bad();
  let heatmap = null;
  if (d.heatmap !== null) {
    if (!Array.isArray(d.heatmap) || d.heatmap.length > 12) bad();
    heatmap = d.heatmap.map(week => {
      if (!Array.isArray(week) || week.length !== 7) bad();
      return week.map(x => {
        if (!object(x) || !day(x.day) || !count(x.count)) bad();
        return {day: x.day, count: x.count};
      });
    });
  }
  let retention = null;
  if (d.retention !== null) {
    if (!Array.isArray(d.retention)) bad();
    retention = d.retention.map(r => {
      if (!object(r) || !LEVELS.includes(r.level) || !count(r.attempts) || !count(r.textsCompleted)
        || !nullable(r.best, number) || !Array.isArray(r.recent) || r.recent.length > 5 || r.recent.some(n => !number(n))
        || !nullable(r.average, number) || !nullable(r.change, number)) bad();
      return {level: r.level, attempts: r.attempts, textsCompleted: r.textsCompleted, best: r.best, recent: [...r.recent], average: r.average, change: r.change};
    });
  }
  return {
    reading: weekSeries(d.reading, 100),
    listening: weekSeries(d.listening, 100),
    writing: weekSeries(d.writing, 9),
    speaking: weekSeries(d.speaking, 9),
    heatmap,
    retention,
  };
}

/** Mock catalogue and attempts (the mock region). Attempt rows never carry snapshots, questions or answers. */
export function progressMocksDTO(d) {
  if (!object(d) || !Array.isArray(d.tests) || !Array.isArray(d.attempts)) bad();
  if (['catalogueUnavailable', 'attemptsUnavailable', 'attemptTitlesUnavailable'].some(k => typeof d[k] !== 'boolean')) bad();
  if (d.tests.some(t => !object(t) || !text(t.id) || !text(t.title) || !SKILLS.includes(t.skill))) bad();
  if (new Set(d.tests.map(t => t.id)).size !== d.tests.length) bad();
  const attempts = d.attempts.map(a => {
    if (!object(a) || ['snapshot', 'mockSnapshot', 'questions', 'answers'].some(k => k in a)) bad();
    if (!text(a.id) || !nullable(a.mockTestId, text) || !nullable(a.title, text) || !nullable(a.skill, s => SKILLS.includes(s))
      || !instant(a.finishedAt) || !nullable(a.estimatedBand, band)) bad();
    return {id: a.id, mockTestId: a.mockTestId ?? null, title: a.title ?? null, skill: a.skill ?? null, finishedAt: toDate(a.finishedAt), estimatedBand: a.estimatedBand ?? null};
  });
  if (new Set(attempts.map(a => a.id)).size !== attempts.length) bad();
  return {
    tests: d.tests.map(t => ({id: t.id, title: t.title, skill: t.skill})),
    attempts,
    catalogueUnavailable: d.catalogueUnavailable,
    attemptsUnavailable: d.attemptsUnavailable,
    attemptTitlesUnavailable: d.attemptTitlesUnavailable,
  };
}
