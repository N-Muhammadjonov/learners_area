import {h} from '../../js/native.js';
import {RiwiClientAdapter} from '../../js/adapters/riwi.js';
import {tRiwi} from '../../js/i18n/riwi_i18n.js';

export const RIWI_WORKSPACE_ROUTE = "/app/riwi";

export function escapeHtml(raw) {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createRiwiWorkspaceController({
  role = "student",
  locale = "uz",
  theme = "day",
  adapter = RiwiClientAdapter
} = {}) {
  const state = {
    role,
    locale: locale === "en" ? "en" : "uz",
    theme: theme === "night" ? "night" : "day",
    conversationId: null,
    targetUserId: null,
    targetOptions: [],
    nextTargetCursor: null,
    messages: [],
    loading: false,
    error: null
  };

  function getSubtitleKey() {
    if (state.role === "teacher") return "riwi.subtitle.teacher";
    if (state.role === "admin") return "riwi.subtitle.admin";
    if (state.role === "owner") return "riwi.subtitle.owner";
    return "riwi.subtitle.student";
  }

  function renderHtml() {
    const showTargetPicker = state.role === "teacher" || state.role === "owner";
    const targetOptionsHtml = state.targetOptions
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}"${state.targetUserId === item.id ? " selected" : ""}>${escapeHtml(item.name)}</option>`
      )
      .join("");

    const messagesHtml = state.messages
      .map((msg) => {
        const provKey = msg.provenance ? `riwi.provenance.${msg.provenance}` : "riwi.provenance.unavailable";
        const badge = msg.role === "assistant"
          ? `<span class="riwi-provenance-badge">${escapeHtml(tRiwi(provKey, state.locale))}</span>`
          : "";
        return `<article class="riwi-msg riwi-msg--${escapeHtml(msg.role)}">
          <header class="riwi-msg__meta">${badge}</header>
          <div class="riwi-msg__body">${escapeHtml(msg.content)}</div>
        </article>`;
      })
      .join("");

    return `<section class="riwi-workspace" data-theme="${escapeHtml(state.theme)}" data-role="${escapeHtml(state.role)}">
      <header class="riwi-workspace__header">
        <div>
          <h1 class="riwi-workspace__title">${escapeHtml(tRiwi("riwi.title", state.locale))}</h1>
          <p class="riwi-workspace__subtitle">${escapeHtml(tRiwi(getSubtitleKey(), state.locale))}</p>
        </div>
        ${showTargetPicker ? `<div class="riwi-target-picker">
          <label for="riwi-target-select">${escapeHtml(tRiwi("riwi.target.label", state.locale))}</label>
          <select id="riwi-target-select">${targetOptionsHtml}</select>
        </div>` : ""}
      </header>
      <div class="riwi-transcript" role="log" aria-live="polite">${messagesHtml}</div>
      <form class="riwi-composer" id="riwi-chat-form">
        <textarea id="riwi-chat-input" maxlength="4000" placeholder="${escapeHtml(tRiwi("riwi.input.placeholder", state.locale))}"></textarea>
        <div class="riwi-composer__actions">
          <button type="submit" class="riwi-btn riwi-btn--primary">${escapeHtml(tRiwi("riwi.send", state.locale))}</button>
          <button type="button" class="riwi-btn riwi-btn--secondary" id="riwi-clear-btn">${escapeHtml(tRiwi("riwi.clear", state.locale))}</button>
        </div>
      </form>
    </section>`;
  }

  async function sendMessage(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    state.loading = true;
    try {
      const payload = { message: trimmed };
      if (state.conversationId) payload.conversationId = state.conversationId;
      if (state.targetUserId && (state.role === "teacher" || state.role === "owner")) {
        payload.targetUserId = state.targetUserId;
      }
      const res = await adapter.sendChat(payload);
      state.conversationId = res.conversationId;
      state.messages.push(
        { role: "user", content: trimmed },
        {
          role: "assistant",
          content: res.answer,
          provenance: res.provenance,
          citations: res.citations || [],
          reportSnapshot: res.reportSnapshot || null
        }
      );
      if (res.roleSurface && Array.isArray(res.roleSurface.targetOptions)) {
        state.targetOptions = res.roleSurface.targetOptions;
        state.nextTargetCursor = res.roleSurface.nextCursor || null;
      }
      return res;
    } finally {
      state.loading = false;
    }
  }

  return {
    state,
    renderHtml,
    sendMessage
  };
}

export function mount(ctx) {
  const {root, locale = 'uz', session} = ctx;
  const role = session?.user?.role || 'student';
  const ctrl = createRiwiWorkspaceController({role, locale});
  const transcript = h('div', {class: 'riwi-transcript flex flex-col gap-3', role: 'log', 'aria-live': 'polite'});
  const input = h('textarea', {class: 'input', maxlength: '4000', placeholder: tRiwi('riwi.input.placeholder', locale)});
  const sendBtn = h('button', {type: 'submit', class: 'btn-primary'}, tRiwi('riwi.send', locale));
  const form = h('form', {
    class: 'card flex flex-col gap-3 p-4',
    onSubmit: async (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      await ctrl.sendMessage(msg);
      transcript.replaceChildren(
        ...ctrl.state.messages.map((m) =>
          h('article', {class: 'card p-3', 'data-riwi-role': m.role},
            h('p', {class: 'text-sm text-ink-900'}, m.content)
          )
        )
      );
    }
  }, input, h('div', {class: 'flex gap-2'}, sendBtn));

  root.append(
    h('section', {class: 'mx-auto flex w-full max-w-4xl flex-col gap-6', 'data-route-usable': 'riwi'},
      h('header', {},
        h('h1', {class: 'font-display text-2xl text-ink-900'}, tRiwi('riwi.title', locale)),
        h('p', {class: 'text-sm text-ink-500'}, tRiwi(`riwi.subtitle.${role}`, locale))
      ),
      transcript,
      form
    )
  );
}
