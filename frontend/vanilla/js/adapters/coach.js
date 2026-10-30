import {api, ApiError} from '../api-client.js';
import {regionPayload} from './view-region.js';

/**
 * V60 AI Coach adapters.
 *
 * REAL backend contract (src/app/api/vocabulary/due/route.ts):
 *   GET /api/vocabulary/due?limit=N   — the spaced-repetition queue, `{ok:true, due:[…]}`.
 *
 * PROPOSED contract, NOT served by the backend today (reported BLOCKED live):
 *   GET /api/frontend/view?route=/app/coach&region=coach
 *        weakness rows, recent evaluations and study recommendations. In the original they are produced by
 *        server functions (getWeaknessSummary, getRecentEvaluations, getStudyRecommendations) inside a Server
 *        Component, so no HTTP route exists yet.
 *
 * The browser never re-ranks recommendations, never invents severity or scores, and never calls an AI or RIWI
 * service. Ranking is the server's: one action per practice area, strongest signal first, resolved patterns
 * dropped. The order of the payload is preserved.
 */
const bad = () => { throw new ApiError(502, 'invalid_coach_adapter'); };
const object = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 300) => typeof x === 'string' && x.length <= max;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = (x) => typeof x === 'string' && Number.isFinite(Date.parse(x));
const count = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 1000000;

export const WEAKNESS_STATUSES = Object.freeze(['open', 'improving', 'resolved']);
export const WEAKNESS_AREAS = Object.freeze(['grammar', 'writing', 'speaking', 'vocabulary']);
export const SEVERITIES = Object.freeze(['low', 'medium', 'high']);
const CATEGORY = /^[A-Z][A-Z_]{2,39}$/;
/** Server-supplied destinations must be internal app paths; anything else is refused, not rendered. */
export const isAppHref = (x) => typeof x === 'string' && x.length <= 200 && /^\/app(?:\/[A-Za-z0-9_-]+)*$/.test(x);

function weakness(w) {
  if (!object(w) || !CATEGORY.test(w.category) || !text(w.label, 200) || !text(w.action, 400)) bad();
  if (!WEAKNESS_AREAS.includes(w.area) || !isAppHref(w.href)) bad();
  if (!count(w.occurrenceCount) || !SEVERITIES.includes(w.recentSeverity) || !WEAKNESS_STATUSES.includes(w.status)) bad();
  if (!isoDate(w.lastSeenAt)) bad();
  return {category: w.category, label: w.label, area: w.area, href: w.href, action: w.action,
    occurrenceCount: w.occurrenceCount, recentSeverity: w.recentSeverity, status: w.status, lastSeenAt: w.lastSeenAt};
}

function evaluationRow(e) {
  if (!object(e) || !UUID.test(String(e.id ?? '')) || !text(e.evaluationType, 40)) bad();
  if (e.overallEstimate !== null && !(typeof e.overallEstimate === 'number' && Number.isFinite(e.overallEstimate)
    && e.overallEstimate >= 0 && e.overallEstimate <= 9)) bad();
  if (e.verdict !== null && !text(e.verdict, 40)) bad();
  if (!text(e.checkedByName, 200) || !isoDate(e.createdAt)) bad();
  return {id: e.id, evaluationType: e.evaluationType, overallEstimate: e.overallEstimate, verdict: e.verdict,
    checkedByName: e.checkedByName, createdAt: e.createdAt};
}

function recommendation(r) {
  if (!object(r) || !WEAKNESS_AREAS.includes(r.area) || !isAppHref(r.href)) bad();
  if (!Array.isArray(r.categories) || r.categories.length === 0 || r.categories.length > 17) bad();
  if (r.categories.some((c) => !CATEGORY.test(c))) bad();
  if (!text(r.reason, 400) || !count(r.occurrenceCount)) bad();
  return {area: r.area, href: r.href, categories: r.categories, reason: r.reason, occurrenceCount: r.occurrenceCount};
}

/** PROPOSED region payload. Order of `recommendations` is the server's ranking and is kept as given. */
export function coachDTO(c) {
  if (!object(c)) bad();
  if (!Array.isArray(c.weaknesses) || c.weaknesses.length > 200) bad();
  if (!Array.isArray(c.recentEvaluations) || c.recentEvaluations.length > 50) bad();
  if (!Array.isArray(c.recommendations) || c.recommendations.length > 10) bad();
  const weaknesses = c.weaknesses.map(weakness);
  if (new Set(weaknesses.map((w) => w.category)).size !== weaknesses.length) bad();
  return {
    weaknesses,
    recentEvaluations: c.recentEvaluations.map(evaluationRow),
    recommendations: c.recommendations.map(recommendation),
  };
}

/** Real: the spaced-repetition due queue (the same endpoint the Vocabulary revision uses). */
export function dueDTO(d) {
  if (!object(d) || d.ok !== true || !Array.isArray(d.due) || d.due.length > 100) bad();
  return d.due.map((w) => {
    if (!object(w) || typeof w.id !== 'string' || !w.id || !text(w.term, 200)) bad();
    return {id: w.id, term: w.term};
  });
}

/** PROPOSED (BLOCKED live): Coach analytics. */
export async function fetchCoach(signal, {fresh = false} = {}) {
  const route = '/app/coach';
  const raw = await api.request('/api/frontend/view?route=' + encodeURIComponent(route) + '&region=coach', {signal, fresh});
  return coachDTO(regionPayload(raw, route, 'coach'));
}

/** Real: due vocabulary for "Review today". `fresh` re-reads after a mutation (see api-client.js). */
export async function fetchDue(signal, limit = 10, {fresh = false} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40) throw new TypeError('invalid limit');
  return dueDTO(await api.request(`/api/vocabulary/due?limit=${limit}`, {signal, fresh}));
}
