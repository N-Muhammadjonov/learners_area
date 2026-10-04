"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { IconSparkles } from "@/components/ui/icons";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n";
import { riwiChatResponseSchema, type RiwiChatResponse } from "@/lib/services/riwi/contracts";

const transcriptSchema = z.object({
  ok: z.literal(true), conversationId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]), content: z.string().max(6000), createdAt: z.string().datetime(),
    correlationId: z.string().uuid().nullable(),
    provenance: z.enum(["canonical_dictionary", "deterministic_learning_data", "deterministic_report", "external_provider", "policy_refusal", "unavailable"]).nullable(),
    provider: z.object({ id: z.string().max(60), model: z.string().max(120).nullable() }).strict().nullable(),
    citations: z.array(z.object({ source: z.string().max(120), version: z.number().int().positive().nullable() }).strict()).max(8),
  }).strict()).max(60),
}).strict();

type FeedbackStatus = "submitting" | "recorded" | "failed";
type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  correlationId: string | null;
  feedbackStatus: FeedbackStatus | null;
  provenance: RiwiChatResponse["provenance"] | null;
  provider: RiwiChatResponse["provider"];
  citations: RiwiChatResponse["citations"];
  uncertainty: string | null;
};

const STORAGE_KEY = "learners-area.riwi.conversation.v1";

function copy(locale: Locale, role: Role) {
  const uz = locale === "uz";
  const roleTitle: Record<Role, string> = {
    student: uz ? "Shaxsiy o'quv yordamchisi" : "Personal learning assistant",
    teacher: uz ? "O'qituvchi yordamchisi" : "Teacher assistant",
    admin: uz ? "Markaz operatsiyalari" : "Centre operations",
    owner: uz ? "Intelligence boshqaruvi" : "Intelligence control",
  };
  const prompts: Record<Role, string[]> = {
    student: uz ? ["Mening progressim qanday?", "resilient so'zining ma'nosi nima?", "Shaxsiy hisobotimni ko'rsat"] : ["How am I doing?", "What does resilient mean?", "Show my personal report"],
    teacher: uz ? ["Biriktirilgan guruhim uchun hisobot", "Articles mavzusini tushuntir", "cohesion ma'nosini ayt"] : ["Show my assigned learners' report", "Explain articles simply", "Define cohesion"],
    admin: uz ? ["Guruh bo'yicha hisobot", "Articles mavzusini tushuntir", "Reading natijalarini ko'rsat"] : ["Show the cohort report", "Explain articles simply", "Show Reading statistics"],
    owner: uz ? ["Markaz bo'yicha hisobot", "Articles mavzusini tushuntir", "cohesion so'zini izohla"] : ["Show the centre report", "Explain articles simply", "Define cohesion"],
  };
  const welcome: Record<Role, string> = {
    student: uz
      ? "Lug'at, shaxsiy progress va deterministik hisobot haqida so'rang. Tashqi AI ishlatilsa, provayder ochiq ko'rsatiladi. Vaqtli Reading yoki Listening urinishi davomida RIWI yordam bermaydi."
      : "Ask about the canonical dictionary, your own progress, or a deterministic personal report. If an external provider is used, RIWI shows its provenance. Help is paused during timed Reading or Listening attempts.",
    teacher: uz
      ? "O'zingizning aniq biriktirilgan guruhingiz bo'yicha hisobot so'rang yoki o'quv mavzusini tushuntiring. Boshqa guruhlar ma'lumoti ochilmaydi."
      : "Ask for a report over your explicitly assigned roster or an educational explanation. Other rosters are outside your scope.",
    admin: uz
      ? "Markaz kohorti bo'yicha ruxsat etilgan hisobotlar va o'quv izohlarini so'rang. Owner darajasidagi provayder kalitlari yoki audit boshqaruvi bu yerda ochilmaydi."
      : "Ask for reports within the admin cohort policy or educational explanations. Owner-only provider secrets and audit controls are not exposed here.",
    owner: uz
      ? "Markaz hisoboti va o'quv izohlaridan foydalaning. Bilim bazasi, provayder sinovlari va auditni boshqarish uchun RIWI boshqaruv paneliga o'ting."
      : "Use the centre report or educational explanations. Open the RIWI control room for governed knowledge, provider evaluation, and audit review.",
  };
  return {
    uz,
    title: roleTitle[role],
    welcome: welcome[role],
    prompts: prompts[role],
    placeholder: uz ? "RIWI'dan nimani so'ramoqchisiz?" : "Ask RIWI a question…",
    send: uz ? "Yuborish" : "Send",
    sending: uz ? "Tekshirilmoqda…" : "Working…",
    clear: uz ? "Yangi suhbat" : "New conversation",
    delete: uz ? "Suhbatni o'chirish" : "Delete conversation",
    deleteFailed: uz ? "Suhbat o'chirilmadi. Qayta urinib ko'ring." : "The conversation was not deleted. Please try again.",
    maxLength: uz ? "Maksimal 4 000 belgi" : "Maximum 4,000 characters",
    note: uz
      ? "Tashqi provayder yoqilgan bo'lsa, faqat vazifa uchun zarur bo'lgan, shaxsiy identifikatorlardan tozalangan matn yuboriladi. Suhbat 30 kundan so'ng tugaydi."
      : "When external AI is enabled, only task-minimized text is sent after direct identifiers are redacted. Conversations expire after 30 days.",
    provider: uz ? "Tashqi provayder" : "External provider",
    dictionary: uz ? "Markaz lug'ati" : "Canonical dictionary",
    report: uz ? "Aniq hisobot" : "Deterministic report",
    learningData: uz ? "O'quv qaydlari" : "Learning records",
    policy: uz ? "Xavfsizlik qoidasi" : "Policy response",
    riwi: uz ? "RIWI" : "RIWI",
    citations: uz ? "Manbalar" : "Sources",
    uncertainty: uz ? "Noaniqlik" : "Uncertainty",
    limit: uz ? "Xabar 4 000 belgidan oshmasligi kerak." : "Message must be 4,000 characters or fewer.",
    failed: uz ? "So'rovni xavfsiz yakunlab bo'lmadi. Qayta urinib ko'ring." : "The request could not be completed safely. Please try again.",
    helpful: uz ? "Foydali" : "Helpful",
    notHelpful: uz ? "Foydali emas" : "Not helpful",
    feedbackThanks: uz ? "Fikringiz uchun rahmat." : "Thanks for your feedback.",
    feedbackFailed: uz ? "Fikr yuborilmadi. Qayta urinib ko'ring." : "Feedback was not sent. Please try again.",
    feedbackSaving: uz ? "Yuborilmoqda…" : "Sending…",
    restored: uz ? "Oldingi suhbat tiklandi." : "Previous conversation restored.",
    restoreFailed: uz ? "Suhbat mavjud emas yoki muddati tugagan; yangi suhbat boshlandi." : "That conversation is unavailable or expired; a new one was started.",
    deleting: uz ? "O'chirilmoqda…" : "Deleting…",
    ownerTools: uz ? "RIWI boshqaruv paneli" : "RIWI control room",
    roleTag: role.toUpperCase(),
  };
}

function provenanceLabel(message: UiMessage, text: ReturnType<typeof copy>) {
  if (message.provider) return `${text.provider}: ${message.provider.id}${message.provider.model ? ` · ${message.provider.model}` : ""}`;
  switch (message.provenance) {
    case "canonical_dictionary": return text.dictionary;
    case "deterministic_report": return text.report;
    case "deterministic_learning_data": return text.learningData;
    case "external_provider": return text.provider;
    case "policy_refusal": return text.policy;
    case "unavailable": return text.riwi;
    default: return text.riwi;
  }
}

export function RiwiChat({ role, locale }: { role: Role; locale: Locale }) {
  const text = copy(locale, role);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [notice, setNotice] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pendingFeedback = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const savedId = window.localStorage.getItem(STORAGE_KEY);
    if (!savedId || !z.string().uuid().safeParse(savedId).success) {
      setLoadingHistory(false);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`/api/riwi/conversations/${encodeURIComponent(savedId)}`, { cache: "no-store", credentials: "same-origin" });
        const payload = transcriptSchema.safeParse(await response.json().catch(() => null));
        if (!response.ok || !payload.success) throw new Error("conversation_unavailable");
        if (cancelled) return;
        setConversationId(payload.data.conversationId);
        setMessages(payload.data.messages.map((message, index) => ({
          id: `${message.createdAt}-${index}`, role: message.role, content: message.content,
          correlationId: message.correlationId, feedbackStatus: null,
          provenance: message.provenance, provider: message.provider, citations: message.citations, uncertainty: null,
        })));
        setNotice(text.restored);
      } catch {
        if (cancelled) return;
        window.localStorage.removeItem(STORAGE_KEY);
        setNotice(text.restoreFailed);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [text.restoreFailed, text.restored]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function startNewConversation() {
    if (busy) return;
    if (conversationId) {
      setBusy(true);
      try {
        const response = await fetch(`/api/riwi/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) throw new Error("delete_failed");
      } catch {
        setNotice(text.deleteFailed);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    window.localStorage.removeItem(STORAGE_KEY);
    setConversationId(null);
    setMessages([]);
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loadingHistory) return;
    const message = draft.trim();
    if (!message) return;
    if (message.length > 4000) { setNotice(text.limit); return; }
    setNotice("");
    setDraft("");
    setMessages((current) => [...current, {
      id: `user-${Date.now()}`, role: "user", content: message, correlationId: null, feedbackStatus: null,
      provenance: null, provider: null, citations: [], uncertainty: null,
    }]);
    setBusy(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch("/api/riwi/chat", {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
      });
      const parsed = riwiChatResponseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) {
        const error = response.status === 429
          ? (text.uz ? "So'rovlar juda ko'p. Biroz kutib qayta urinib ko'ring." : "Too many requests. Wait a moment and try again.")
          : response.status === 401
          ? (text.uz ? "Davom etish uchun tizimga qayta kiring." : "Please sign in again to continue.")
          : text.failed;
        throw new Error(error);
      }
      const result = parsed.data;
      if (result.conversationId) {
        setConversationId(result.conversationId);
        window.localStorage.setItem(STORAGE_KEY, result.conversationId);
      }
      setMessages((current) => [...current, {
        id: result.correlationId, role: "assistant", content: result.answer,
        correlationId: result.ok ? result.correlationId : null, feedbackStatus: null,
        provenance: result.provenance, provider: result.provider, citations: result.citations, uncertainty: result.uncertainty,
      }]);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const fallback = error instanceof Error && !aborted ? error.message : text.failed;
      setMessages((current) => [...current, {
        id: `failed-${Date.now()}`, role: "assistant", content: fallback, correlationId: null, feedbackStatus: null,
        provenance: "unavailable", provider: null, citations: [], uncertainty: null,
      }]);
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  }

  async function submitFeedback(messageId: string, rating: "helpful" | "not_helpful") {
    const message = messages.find((item) => item.id === messageId);
    if (role !== "student" || !message?.correlationId || message.feedbackStatus === "recorded" || pendingFeedback.current.has(messageId)) return;
    pendingFeedback.current.add(messageId);
    setMessages((current) => current.map((item) => item.id === messageId ? { ...item, feedbackStatus: "submitting" } : item));
    try {
      const response = await fetch("/api/riwi/feedback", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ correlationId: message.correlationId, rating }),
      });
      const result = await response.json().catch(() => null) as { ok?: unknown } | null;
      if (!response.ok || result?.ok !== true) throw new Error("feedback_unavailable");
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, feedbackStatus: "recorded" } : item));
    } catch {
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, feedbackStatus: "failed" } : item));
    } finally {
      pendingFeedback.current.delete(messageId);
    }
  }

  const examples = text.prompts;
  const welcomeMessage = messages.length === 0;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5" data-riwi-chat data-role={role}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent-strong">
            <IconSparkles className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">RIWI · {text.roleTag}</p>
            <h1 className="font-display text-3xl text-ink-900">{text.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-500">{text.note}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role === "owner" && <Link href="/owner/riwi" className="btn-secondary">{text.ownerTools}</Link>}
          <button type="button" onClick={startNewConversation} className="btn-ghost" disabled={busy || loadingHistory}>
            {conversationId ? text.delete : text.clear}
          </button>
        </div>
      </header>

      <section aria-label={text.title} className="flex min-h-[54vh] flex-col overflow-hidden rounded-3xl border border-ink-100 bg-paper-raised shadow-card">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-700"><IconSparkles className="h-4 w-4 text-accent" /> RIWI</div>
          <span className="text-xs text-ink-300">{loadingHistory ? (text.uz ? "Yuklanmoqda…" : "Loading…") : (text.uz ? "Xavfsiz yordamchi" : "Bounded assistant")}</span>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {welcomeMessage && (
            <div className="max-w-3xl self-start rounded-2xl rounded-tl-sm bg-paper-sunken px-4 py-3 text-sm leading-6 text-ink-700">
              <p>{text.welcome}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {examples.map((example) => <button key={example} type="button" className="rounded-full border border-ink-100 bg-paper-raised px-3 py-1.5 text-xs text-ink-700 transition hover:border-accent/50" onClick={() => setDraft(example)}>{example}</button>)}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`max-w-3xl rounded-2xl px-4 py-3 ${message.role === "user" ? "self-end rounded-tr-sm bg-accent text-accent-contrast" : "self-start rounded-tl-sm bg-paper-sunken text-ink-700"}`}>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
              {message.role === "assistant" && message.provenance && (
                <p className="mt-3 border-t border-ink-100/70 pt-2 text-[11px] font-medium text-ink-500">
                  {provenanceLabel(message, text)}
                </p>
              )}
              {message.uncertainty && <p className="mt-2 text-xs text-band-warn"><span className="font-semibold">{text.uncertainty}:</span> {message.uncertainty}</p>}
              {message.citations.length > 0 && (
                <div className="mt-2 text-xs text-ink-500">
                  <span className="font-semibold">{text.citations}: </span>
                  {message.citations.map((citation, index) => <span key={`${citation.source}-${index}`}>{citation.source}{citation.version ? ` · v${citation.version}` : ""}{index + 1 < message.citations.length ? ", " : ""}</span>)}
                </div>
              )}
              {role === "student" && message.role === "assistant" && message.correlationId
                && message.provenance && !["policy_refusal", "unavailable"].includes(message.provenance) && (
                  <div className="mt-3 border-t border-ink-100/70 pt-2" aria-label={text.uz ? "Javob haqida fikr" : "Answer feedback"}>
                    {message.feedbackStatus === "recorded" ? <p className="text-xs text-ink-500" role="status">{text.feedbackThanks}</p> : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-ink-500">{message.feedbackStatus === "failed" ? text.feedbackFailed : text.uz ? "Javob foydali bo'ldimi?" : "Was this answer helpful?"}</span>
                        <button type="button" className="btn-ghost min-h-8 px-2 py-1 text-xs" disabled={message.feedbackStatus === "submitting"}
                          onClick={() => void submitFeedback(message.id, "helpful")}>
                          {message.feedbackStatus === "submitting" ? text.feedbackSaving : text.helpful}
                        </button>
                        <button type="button" className="btn-ghost min-h-8 px-2 py-1 text-xs" disabled={message.feedbackStatus === "submitting"}
                          onClick={() => void submitFeedback(message.id, "not_helpful")}>{text.notHelpful}</button>
                      </div>
                    )}
                  </div>
                )}
            </article>
          ))}
          {busy && <div className="max-w-3xl self-start rounded-2xl bg-paper-sunken px-4 py-3 text-sm text-ink-500" role="status">{text.sending}</div>}
          {notice && <p className="text-xs text-ink-500" role="status">{notice}</p>}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={submit} className="border-t border-ink-100 p-3 sm:p-4">
          <label className="sr-only" htmlFor="riwi-message">{text.placeholder}</label>
          <div className="flex items-end gap-2 rounded-2xl border border-ink-100 bg-paper px-3 py-2 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
            <textarea id="riwi-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={2} placeholder={text.placeholder} className="max-h-40 min-h-12 flex-1 resize-y bg-transparent py-2 text-sm text-ink-900 outline-none placeholder:text-ink-300" disabled={busy || loadingHistory} />
            <button type="submit" className="btn-primary min-h-11 shrink-0" disabled={busy || loadingHistory || !draft.trim()}>{busy ? text.sending : text.send}</button>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-ink-300">
            <span>{text.maxLength}</span><span>{draft.length}/4000</span>
          </div>
        </form>
      </section>
    </main>
  );
}
