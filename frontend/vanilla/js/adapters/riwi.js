const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest"
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({ ok: false, error: "invalid_json" }));
  if (!response.ok) {
    const err = new Error(data.error || `http_${response.status}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
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
  getOwnerDiagnostics() {
    return requestJson("/api/riwi/owner/diagnostics", { method: "GET" });
  },
  getOwnerAudit(cursor = null, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return requestJson(`/api/riwi/owner/audit?${params.toString()}`, { method: "GET" });
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
  promoteKnowledgeCandidate(sourceId, regressionFixtureId) {
    return requestJson(`/api/riwi/owner/knowledge/${encodeURIComponent(sourceId)}/promote`, {
      method: "POST",
      body: JSON.stringify({ regressionFixtureId })
    });
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
  }
};
