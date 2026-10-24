import {api, ApiError} from '../api-client.js';
import {regionPayload} from './view-region.js';

/**
 * V59 Assignments adapters.
 *
 * REAL backend contracts (src/app/api/assignments/*):
 *   GET  /api/assignments                — the learner's rows from assignment_targets (not target_user_id).
 *   POST /api/assignments/:id/evaluate   — submit a response; the server evaluates and marks the target completed.
 *
 * PROPOSED contract, NOT served by the backend today (reported BLOCKED live):
 *   GET  /api/frontend/view?route=/app/assignments&region=assignmentDetails
 *        saved response, evaluation summary and materials. In the original these come from server
 *        functions inside a React Server Component, so no HTTP route exists yet.
 *
 * Every payload is validated fail-closed: a shape the page does not understand becomes a 502 and is never
 * rendered as data. Status, deadline and grade are never inferred in the browser.
 */
const bad = () => { throw new ApiError(502, 'invalid_assignments_adapter'); };
const object = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 2000) => typeof x === 'string' && x.length <= max;
const nullableText = (x, max) => x === null || text(x, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoOrNull = (x) => x === null || (typeof x === 'string' && Number.isFinite(Date.parse(x)));
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}$/;

export const ASSIGNMENT_STATUSES = Object.freeze(['not_started', 'in_progress', 'completed']);
export const DISPATCH_KINDS = Object.freeze(['writing', 'free_form']);
export const RESOURCE_TYPES = Object.freeze(['text', 'link', 'image', 'audio', 'file']);
export const MIN_RESPONSE_LENGTH = 20;
export const MAX_RESPONSE_LENGTH = 20000;

function contentReference(c) {
  if (!object(c)) bad();
  if (!text(c.module, 20) || !text(c.contentType, 40) || !text(c.sourceRef, 80) || !text(c.versionId, 80)) bad();
  if (c.versionNo !== null && !(Number.isSafeInteger(c.versionNo) && c.versionNo >= 0)) bad();
  if (c.versionStatus !== null && !text(c.versionStatus, 40)) bad();
  return {module: c.module, contentType: c.contentType, sourceRef: c.sourceRef, versionId: c.versionId,
    versionNo: c.versionNo, versionStatus: c.versionStatus};
}

function learnerAssignment(a) {
  if (!object(a) || typeof a.id !== 'string' || !UUID.test(a.id)) bad();
  if (!text(a.title, 200) || a.title.trim().length === 0) bad();
  if (!nullableText(a.description, 2000) || !nullableText(a.instructions, 4000)) bad();
  if (!ASSIGNMENT_STATUSES.includes(a.status)) bad();
  if (!isoOrNull(a.dueAt)) bad();
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    instructions: a.instructions,
    status: a.status,
    dueAt: a.dueAt,
    content: contentReference(a.content),
  };
}

/** Learner list from `GET /api/assignments`. Order is the server's (newest first). */
export function assignmentListDTO(d) {
  if (!object(d) || d.ok !== true || !Array.isArray(d.assignments) || d.assignments.length > 500) bad();
  const list = d.assignments.map(learnerAssignment);
  if (new Set(list.map((x) => x.id)).size !== list.length) bad();
  return list;
}

/** Response of `POST /api/assignments/:id/evaluate` (success only; errors arrive as ApiError). */
export function submitResultDTO(d) {
  if (!object(d) || d.ok !== true) bad();
  if (!DISPATCH_KINDS.includes(d.dispatchedTo)) bad();
  if (typeof d.evaluationId !== 'string' || !UUID.test(d.evaluationId)) bad();
  if (!text(d.checkedBy, 200) || d.checkedBy.trim().length === 0) bad();
  if (d.verdict !== undefined && d.verdict !== null && !text(d.verdict, 40)) bad();
  return {dispatchedTo: d.dispatchedTo, evaluationId: d.evaluationId, checkedBy: d.checkedBy, verdict: d.verdict ?? null};
}

function resourceBlock(b) {
  if (!object(b) || typeof b.id !== 'string' || !b.id) bad();
  if (!RESOURCE_TYPES.includes(b.type)) bad();
  if (!Number.isSafeInteger(b.position) || b.position < 0) bad();
  if (!nullableText(b.textContent, 20000) || !nullableText(b.originalName, 300) || !nullableText(b.mimeType, 120)) bad();
  if (b.linkUrl !== null && !(text(b.linkUrl, 2000) && /^https?:\/\//i.test(b.linkUrl))) bad();
  if (b.objectKey !== null && !(typeof b.objectKey === 'string' && OBJECT_KEY.test(b.objectKey) && !b.objectKey.includes('..'))) bad();
  if (b.size !== null && !(Number.isSafeInteger(b.size) && b.size >= 0)) bad();
  return {id: b.id, type: b.type, position: b.position, textContent: b.textContent, linkUrl: b.linkUrl,
    objectKey: b.objectKey, originalName: b.originalName, mimeType: b.mimeType, size: b.size};
}

/** PROPOSED per-assignment projection (the region payload): `[{assignmentId,response,evaluation,materials}]`. */
export function assignmentDetailsDTO(rows) {
  if (!Array.isArray(rows) || rows.length > 500) bad();
  const byId = new Map();
  for (const d of rows) {
    if (!object(d) || typeof d.assignmentId !== 'string' || !UUID.test(d.assignmentId)) bad();
    if (byId.has(d.assignmentId)) bad();
    if (d.response !== null && !text(d.response, MAX_RESPONSE_LENGTH)) bad();
    let evaluation = null;
    if (d.evaluation !== null) {
      if (!object(d.evaluation) || !text(d.evaluation.checkedByName, 200)) bad();
      if (d.evaluation.verdict !== null && !text(d.evaluation.verdict, 40)) bad();
      evaluation = {checkedByName: d.evaluation.checkedByName, verdict: d.evaluation.verdict};
    }
    if (!Array.isArray(d.materials) || d.materials.length > 50) bad();
    byId.set(d.assignmentId, {response: d.response, evaluation, materials: d.materials.map(resourceBlock)
      .sort((a, b) => a.position - b.position)});
  }
  return byId;
}

/** Real: GET /api/assignments (the caller's own targets). */
export async function fetchAssignmentList(signal, {fresh = false} = {}) {
  return assignmentListDTO(await api.request('/api/assignments', {signal, fresh}));
}

/** Real: POST /api/assignments/:id/evaluate. Never retried by the transport; a double click is blocked by the page. */
export async function submitAssignment(assignmentId, response, signal) {
  if (!UUID.test(assignmentId)) throw new TypeError('invalid assignment id');
  const body = {response};
  return submitResultDTO(await api.request(`/api/assignments/${assignmentId}/evaluate`, {method: 'POST', body, signal}));
}

/** PROPOSED (BLOCKED live): saved responses, evaluation summaries and materials. */
export async function fetchAssignmentDetails(signal, {fresh = false} = {}) {
  const route = '/app/assignments';
  const raw = await api.request('/api/frontend/view?route=' + encodeURIComponent(route) + '&region=assignmentDetails', {signal, fresh});
  return assignmentDetailsDTO(regionPayload(raw, route, 'assignmentDetails'));
}
