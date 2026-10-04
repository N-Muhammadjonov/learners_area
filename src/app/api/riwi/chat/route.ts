import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { hasOpenExam, extractDictionaryTerm } from "@/lib/services/riwi/dictionary";
import { riwiErrorMessage, type RiwiErrorCode } from "@/lib/services/riwi/errors";
import {
  appendRiwiTurn,
  getRiwiConversationHistory,
  openRiwiConversation,
  RiwiConversationError,
} from "@/lib/services/riwi/conversations";
import { retrieveActiveKnowledge } from "@/lib/services/riwi/knowledge";
import { routeRiwiAnswer } from "@/lib/services/riwi/provider-router";
import { readRiwiRollout, riwiEnabledForRole } from "@/lib/services/riwi/rollout";
import { classifyRiwiIntent, riwiChatRequestSchema, riwiChatResponseSchema, type RiwiIntent, type RiwiChatResponse } from "@/lib/services/riwi/contracts";
import { authorizeCapability } from "@/lib/services/riwi/capabilities";
import { recordRiwiAudit } from "@/lib/services/riwi/audit";
import { riwiToolBroker } from "@/lib/services/riwi/core-tools";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { Locale } from "@/lib/i18n";
import type { RetrievedKnowledge } from "@/lib/services/riwi/knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_CITATIONS: RiwiChatResponse["citations"] = [];

function localeFor(user: CurrentUser): Locale {
  return user.locale === "en" ? "en" : "uz";
}

function json(value: RiwiChatResponse, status = 200) {
  return NextResponse.json(riwiChatResponseSchema.parse(value), {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}

function answerBody(input: {
  ok: boolean;
  correlationId: string;
  conversationId?: string | null;
  intent: RiwiIntent;
  answer: string;
  uncertainty?: string | null;
  citations?: RiwiChatResponse["citations"];
  provenance: RiwiChatResponse["provenance"];
  provider?: RiwiChatResponse["provider"];
  errorCode?: RiwiErrorCode | null;
}): RiwiChatResponse {
  const clean = (value: string, max: number) => value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, max);
  return riwiChatResponseSchema.parse({
    ok: input.ok,
    correlationId: input.correlationId,
    conversationId: input.conversationId ?? null,
    intent: input.intent,
    answer: clean(input.answer, 6000),
    uncertainty: input.uncertainty ? clean(input.uncertainty, 600) : null,
    citations: input.citations ?? NO_CITATIONS,
    attribution: "RIWI",
    provenance: input.provenance,
    provider: input.provider ?? null,
    errorCode: input.errorCode ?? null,
  });
}

function failure(input: { correlationId: string; locale: Locale; intent: RiwiIntent; code: RiwiErrorCode; conversationId?: string | null; status?: number }) {
  return json(answerBody({
    ok: false, correlationId: input.correlationId, conversationId: input.conversationId,
    intent: input.intent, answer: riwiErrorMessage(input.code, input.locale),
    provenance: input.code === "riwi_security_denial" ? "policy_refusal" : "unavailable", errorCode: input.code,
  }), input.status ?? 200);
}

async function denyAudit(user: CurrentUser, correlationId: string, status: string) {
  await recordRiwiAudit({ actorUserId: user.id, action: "riwi.request.denied", targetType: "riwi_request", targetId: correlationId,
    metadata: { correlationId, role: user.role, status } }).catch(() => {});
}

async function callTool(name: string, input: unknown, user: CurrentUser, correlationId: string, signal: AbortSignal) {
  return riwiToolBroker.call(name, input, {
    actor: { id: user.id, role: user.role, accountStatus: user.accountStatus }, correlationId, signal,
  });
}

function toolFailureCode(result: { ok: false; code: string }): RiwiErrorCode {
  if (result.code === "riwi_permission_denied") return "riwi_permission_denied";
  if (result.code === "riwi_scope_denied") return "riwi_scope_denied";
  if (result.code === "riwi_tool_invalid_input") return "riwi_tool_invalid_input";
  if (result.code === "riwi_tool_timeout") return "riwi_tool_timeout";
  return "riwi_tool_failed";
}

type ProgressValue = {
  weaknesses: Array<{ label: string; area: string; occurrenceCount: number; recentSeverity: string; status: "open" | "improving" | "resolved" }>;
  dueVocabulary: Array<{ term: string; definition: string; state: string }>;
};
type ReportValue = {
  status: "ready" | "unavailable";
  reason?: string;
  period?: { fromDate: string; toDate: string };
  metrics?: Array<{ key: string; label: string; unit: "count" | "ratio" | "band" | "score"; value: number | null }>;
  narrative?: string[];
};

function formatProgress(value: ProgressValue, locale: Locale): string {
  const lines: string[] = [];
  if (value.weaknesses.length) {
    lines.push(locale === "uz" ? "E'tibor berish kerak bo'lgan yo'nalishlar:" : "Areas to focus on:");
    for (const item of value.weaknesses.slice(0, 8)) {
      lines.push(`• ${item.label} — ${item.occurrenceCount} ${locale === "uz" ? "holat" : "recorded item(s)"} (${item.status}; ${item.recentSeverity}).`);
    }
  }
  if (value.dueVocabulary.length) {
    lines.push(locale === "uz" ? "Bugun takrorlash uchun:" : "Due for review:");
    for (const item of value.dueVocabulary.slice(0, 8)) lines.push(`• ${item.term}: ${item.definition}`);
  }
  if (!lines.length) return locale === "uz"
    ? "Hozircha RIWI shaxsiy progress bo'yicha yetarli qayd topmadi. Mashq bajarilgach, bu yerda ko'rinadi."
    : "There is not enough recorded activity for a personal summary yet. Complete a practice activity and check again.";
  return lines.join("\n");
}

function formatReport(value: ReportValue, locale: Locale): string | null {
  if (value.status !== "ready" || !value.period || !value.metrics) return null;
  const lines = [...(value.narrative ?? [])];
  lines.push(`${locale === "uz" ? "Davr" : "Period"}: ${value.period.fromDate} — ${value.period.toDate}`);
  for (const metric of value.metrics) {
    const display = metric.value === null ? "—" : metric.unit === "ratio" ? `${(metric.value * 100).toFixed(1)}%` : metric.unit === "count" ? String(Math.round(metric.value)) : metric.value.toFixed(2);
    lines.push(`${metric.label}: ${display}`);
  }
  return lines.join("\n");
}

async function persistTurn(input: {
  user: CurrentUser;
  conversationId: string;
  message: string;
  response: RiwiChatResponse;
  externalEligible: boolean;
}) {
  await appendRiwiTurn({
    actor: { id: input.user.id, role: input.user.role }, conversationId: input.conversationId,
    userMessage: input.message, assistantMessage: input.response.answer,
    metadata: {
      intent: input.response.intent,
      providerId: input.response.provider?.id ?? null,
      model: input.response.provider?.model ?? null,
      fallbackUsed: false,
      externalEligible: input.externalEligible,
      provenance: input.response.provenance,
      citations: input.response.citations,
    },
  });
}

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const locale = localeFor(user);
  const intentFallback: RiwiIntent = "unknown";

  if (!riwiEnabledForRole(user.role)) {
    await denyAudit(user, correlationId, "riwi_not_enabled");
    return failure({ correlationId, locale, intent: intentFallback, code: "riwi_not_enabled", status: 404 });
  }
  if (!authorizeCapability({ id: user.id, role: user.role, accountStatus: user.accountStatus }, "riwi.chat.self").allowed) {
    await denyAudit(user, correlationId, "riwi_chat_capability_denied");
    return failure({ correlationId, locale, intent: intentFallback, code: "riwi_permission_denied", status: 403 });
  }
  const origin = checkRequestOrigin(req);
  if (!origin.allowed) {
    await denyAudit(user, correlationId, `origin_${origin.reason}`);
    return failure({ correlationId, locale, intent: intentFallback, code: "riwi_request_invalid", status: 403 });
  }

  const ipLimit = consume(RULES.riwiChatByIp, clientKey(req));
  const accountLimit = consume(RULES.riwiChatByAccount, accountKey(user.id));
  if (!ipLimit.ok || !accountLimit.ok) {
    await denyAudit(user, correlationId, "rate_limited");
    const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds);
    return NextResponse.json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: retryAfter }, {
      status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "private, no-store" },
    });
  }

  const parsedBody = await readRiwiBoundedJson(req);
  if (!parsedBody.ok) {
    await denyAudit(user, correlationId, parsedBody.reason);
    return failure({ correlationId, locale, intent: intentFallback, code: "riwi_request_invalid", status: parsedBody.reason === "too_large" ? 413 : 400 });
  }
  const parsed = riwiChatRequestSchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    await denyAudit(user, correlationId, "invalid_request");
    return failure({ correlationId, locale, intent: intentFallback, code: "riwi_request_invalid", status: 400 });
  }

  const message = parsed.data.message;
  const intent = classifyRiwiIntent(message);
  try {
    await recordRiwiAudit({ actorUserId: user.id, action: "riwi.request.started", targetType: "riwi_request", targetId: correlationId,
      metadata: { correlationId, role: user.role, intent, status: "started" } });
  } catch {
    return failure({ correlationId, locale, intent, code: "riwi_tool_failed", status: 503 });
  }

  if (!readRiwiRollout().roles[user.role]) {
    await denyAudit(user, correlationId, "riwi_role_disabled");
    return failure({ correlationId, locale, intent, code: "riwi_not_enabled", status: 404 });
  }

  if (intent === "security_denial") {
    await denyAudit(user, correlationId, "security_denial");
    const response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_security_denial", locale),
      errorCode: "riwi_security_denial", provenance: "policy_refusal" });
    try {
      await recordRiwiAudit({ actorUserId: user.id, action: "riwi.request.completed", targetType: "riwi_request", targetId: correlationId,
        metadata: { correlationId, role: user.role, intent, answerSource: response.provenance, status: "refused" } });
    } catch { return failure({ correlationId, locale, intent, code: "riwi_tool_failed", status: 503 }); }
    return json(response);
  }

  try {
    if (user.role === "student" && await hasOpenExam({ id: user.id, role: user.role })) {
      await denyAudit(user, correlationId, "active_exam");
      const response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_exam_help_locked", locale),
        errorCode: "riwi_exam_help_locked", provenance: "policy_refusal" });
      await recordRiwiAudit({ actorUserId: user.id, action: "riwi.request.completed", targetType: "riwi_request", targetId: correlationId,
        metadata: { correlationId, role: user.role, intent, answerSource: response.provenance, status: "refused" } });
      return json(response);
    }

    const conversation = await openRiwiConversation({
      actor: { id: user.id, role: user.role }, locale,
      ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
    });

    let response: RiwiChatResponse;
    let externalEligible = false;

    if (intent === "dictionary_lookup") {
      const term = extractDictionaryTerm(message);
      const result = await callTool("riwi.dictionary.lookup", { term: term ?? message, language: locale }, user, correlationId, req.signal);
      if (!result.ok) {
        const errorCode = toolFailureCode(result);
        response = answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
          answer: riwiErrorMessage(errorCode, locale), errorCode, provenance: "unavailable" });
      } else {
        const value = result.value as { status: "locked" | "unresolved" | "resolved"; term?: string; answer?: string; uncertainty?: string | null; source?: string; verified?: boolean };
        if (value.status === "locked") {
          response = answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
            answer: riwiErrorMessage("riwi_dictionary_locked", locale), errorCode: "riwi_dictionary_locked", provenance: "policy_refusal" });
        } else if (value.status !== "resolved") {
          response = answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
            answer: riwiErrorMessage("riwi_dictionary_unresolved", locale), errorCode: "riwi_dictionary_unresolved", provenance: "canonical_dictionary" });
        } else {
          response = answerBody({ ok: true, correlationId, conversationId: conversation.id, intent,
            answer: value.answer ?? "", uncertainty: value.uncertainty,
            citations: value.source ? [{ source: value.source.slice(0, 120), version: null }] : [], provenance: "canonical_dictionary" });
        }
      }
    } else if (intent === "progress_self") {
      const toolName = user.role === "student" ? "riwi.learning.progress.readSelf" : null;
      const result = toolName ? await callTool(toolName, {}, user, correlationId, req.signal) : null;
      if (!result || !result.ok) {
        const errorCode = result && !result.ok ? toolFailureCode(result) : "riwi_scope_denied";
        response = answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
          answer: riwiErrorMessage(errorCode, locale), errorCode, provenance: "unavailable" });
      } else {
        response = answerBody({ ok: true, correlationId, conversationId: conversation.id, intent,
          answer: formatProgress(result.value as ProgressValue, locale), provenance: "deterministic_learning_data" });
      }
    } else if (intent === "report_self") {
      const toolName = user.role === "student" ? "riwi.report.readSelf"
        : user.role === "teacher" ? "riwi.report.readAssigned"
        : user.role === "admin" ? "riwi.report.readAdminScope" : "riwi.report.readGlobal";
      const result = await callTool(toolName, { language: locale }, user, correlationId, req.signal);
      if (!result.ok) {
        const errorCode = toolFailureCode(result);
        response = answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
          answer: riwiErrorMessage(errorCode, locale), errorCode, provenance: "unavailable" });
      } else {
        const value = result.value as ReportValue;
        const text = formatReport(value, locale);
        response = text
          ? answerBody({ ok: true, correlationId, conversationId: conversation.id, intent, answer: text, provenance: "deterministic_report" })
          : answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
              answer: riwiErrorMessage(value.reason === "invalid_period" ? "riwi_request_invalid" : "riwi_tool_failed", locale),
              errorCode: value.reason === "invalid_period" ? "riwi_request_invalid" : "riwi_tool_failed", provenance: "unavailable" });
      }
    } else {
      externalEligible = true;
      const [history, knowledge] = await Promise.all([
        getRiwiConversationHistory({ actor: { id: user.id, role: user.role }, conversationId: conversation.id }),
        retrieveActiveKnowledge(message, { id: user.id, role: user.role }),
      ]);
      const routed = await routeRiwiAnswer({
        actor: { id: user.id, role: user.role }, correlationId,
        payload: { language: locale, message, history, knowledge: knowledge.map((item) => ({
          ref: item.ref, text: item.text, authority: item.authority, version: item.version,
        })) },
        profile: "riwi_chat", signal: req.signal,
      });
      if (routed.status !== "external_success") {
        const errorCode = routed.reason === "timeout" ? "riwi_provider_timeout"
          : routed.reason === "invalid_response" || routed.reason === "invalid_request" ? "riwi_provider_invalid_response"
          : "riwi_provider_unavailable";
        response = answerBody({ ok: false, correlationId, conversationId: conversation.id, intent,
          answer: riwiErrorMessage(errorCode, locale), errorCode, provenance: "unavailable" });
      } else {
        const sourceByRef = new Map(knowledge.map((item: RetrievedKnowledge) => [item.ref, item]));
        const citations = routed.citations.flatMap((ref) => {
          const source = sourceByRef.get(ref);
          return source ? [{ source: source.title.slice(0, 120), version: source.version }] : [];
        });
        response = answerBody({ ok: true, correlationId, conversationId: conversation.id, intent,
          answer: routed.answer, uncertainty: routed.uncertainty, citations, provenance: "external_provider",
          provider: { id: routed.providerId, model: routed.model } });
      }
    }

    try {
      await recordRiwiAudit({ actorUserId: user.id, action: "riwi.request.completed", targetType: "riwi_request", targetId: correlationId,
        metadata: { correlationId, role: user.role, intent, answerSource: response.provenance, providerId: response.provider?.id,
          model: response.provider?.model ?? undefined, status: response.ok ? "succeeded" : "refused", resultCount: response.citations.length } });
    } catch {
      return failure({ correlationId, locale, intent, code: "riwi_tool_failed", status: 503 });
    }
    await persistTurn({ user, conversationId: conversation.id, message, response, externalEligible });
    return json(response);
  } catch (error) {
    const code = error instanceof RiwiConversationError && error.code === "not_found" ? "riwi_scope_denied" : "riwi_tool_failed";
    await denyAudit(user, correlationId, error instanceof RiwiConversationError ? error.code : "request_failed");
    return failure({ correlationId, locale, intent, code, status: 503 });
  }
}
