import { api } from "../api-client.js";

async function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const rawBody = options.body;
  const body =
    rawBody === undefined
      ? undefined
      : typeof rawBody === "string"
        ? JSON.parse(rawBody)
        : rawBody;
  return api.request(url, {
    method,
    body,
    signal: options.signal
  });
}

export const RiwiClientAdapter = {
  sendChat(payload) {
    return requestJson("/api/riwi/chat", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  getConversation(conversationId) {
    return requestJson(`/api/riwi/conversations/${encodeURIComponent(conversationId)}`, {
      method: "GET"
    });
  },
  deleteConversation(conversationId) {
    return requestJson(`/api/riwi/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE"
    });
  },
  listTargets(cursor = null, limit = 25) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return requestJson(`/api/riwi/targets?${params.toString()}`, { method: "GET" });
  },
  touchPresence() {
    return requestJson("/api/riwi/presence", { method: "POST", body: JSON.stringify({}) });
  },
  submitFeedback({ conversationId, helpful, reason }) {
    return requestJson("/api/riwi/feedback", {
      method: "POST",
      body: JSON.stringify({ conversationId, helpful: Boolean(helpful), reason: String(reason || "") })
    });
  },
  explainObjectiveQuestion({ module, attemptId, questionId, locale }) {
    return requestJson("/api/riwi/objective-explanation", {
      method: "POST",
      body: JSON.stringify({ module, attemptId, questionId, locale })
    });
  },
  getLearningSignals() {
    return requestJson("/api/riwi/learning-signals", { method: "GET" });
  },
  createLearningSignal(payload) {
    return requestJson("/api/riwi/learning-signals", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  reviewLearningSignal(signalId, payload) {
    return requestJson(`/api/riwi/learning-signals/${encodeURIComponent(signalId)}/review`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  promoteLearningSignalToKnowledge(signalId) {
    return requestJson(`/api/riwi/learning-signals/${encodeURIComponent(signalId)}/knowledge`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  getOwnerDiagnostics() {
    return requestJson("/api/riwi/owner/diagnostics", { method: "GET" });
  },
  getOwnerAudit(cursor = null, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return requestJson(`/api/riwi/owner/audit?${params.toString()}`, { method: "GET" });
  },
  getOwnerKnowledge() {
    return requestJson("/api/riwi/owner/knowledge", { method: "GET" });
  },
  getOwnerKnowledgeConflicts() {
    return requestJson("/api/riwi/owner/knowledge/conflicts", { method: "GET" });
  },
  createKnowledgeCandidate(payload) {
    return requestJson("/api/riwi/owner/knowledge", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  approveKnowledgeCandidate(sourceId) {
    return requestJson(`/api/riwi/owner/knowledge/${encodeURIComponent(sourceId)}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  rejectKnowledgeCandidate(sourceId) {
    return requestJson(`/api/riwi/owner/knowledge/${encodeURIComponent(sourceId)}/reject`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  promoteKnowledgeCandidate(sourceId, regressionFixtureId) {
    return requestJson(`/api/riwi/owner/knowledge/${encodeURIComponent(sourceId)}/promote`, {
      method: "POST",
      body: JSON.stringify({ regressionFixtureId })
    });
  },
  getProviderLabExperiments() {
    return requestJson("/api/riwi/owner/provider-lab", { method: "GET" });
  },
  runProviderLabExperiment({ fixtureId, providerIds, idempotencyKey }) {
    return requestJson("/api/riwi/owner/provider-lab", {
      method: "POST",
      body: JSON.stringify({ fixtureId, providerIds, idempotencyKey })
    });
  },
  getOwnerSecuritySignals() {
    return requestJson("/api/riwi/owner/security-signals", { method: "GET" });
  },
  reviewOwnerSecuritySignal(signalId, { state, regressionFixtureId }) {
    return requestJson(`/api/riwi/owner/security-signals/${encodeURIComponent(signalId)}/review`, {
      method: "POST",
      body: JSON.stringify({ state, regressionFixtureId })
    });
  },
  getAssessmentPolicies() {
    return requestJson("/api/riwi/owner/assessment-policies", { method: "GET" });
  },
  previewAssessmentPolicy({ scope, overlay }) {
    return requestJson("/api/riwi/owner/assessment-policies/preview", {
      method: "POST",
      body: JSON.stringify({ scope, overlay })
    });
  },
  createAssessmentPolicy({ scope, overlay }) {
    return requestJson("/api/riwi/owner/assessment-policies", {
      method: "POST",
      body: JSON.stringify({ scope, overlay })
    });
  },
  approveAssessmentPolicy(versionId, contentHash) {
    return requestJson(`/api/riwi/owner/assessment-policies/${encodeURIComponent(versionId)}/approve`, {
      method: "POST",
      body: JSON.stringify({contentHash})
    });
  },
  rejectAssessmentPolicy(versionId, contentHash) {
    return requestJson(`/api/riwi/owner/assessment-policies/${encodeURIComponent(versionId)}/reject`, {
      method: "POST",
      body: JSON.stringify({contentHash})
    });
  },
  rollbackAssessmentPolicy(versionId, contentHash) {
    return requestJson(`/api/riwi/owner/assessment-policies/${encodeURIComponent(versionId)}/rollback`, {
      method: "POST",
      body: JSON.stringify({contentHash})
    });
  }
};
