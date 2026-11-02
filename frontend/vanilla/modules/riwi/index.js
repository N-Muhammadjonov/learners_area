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
    feedbackSubmitted: false,
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
        const citationsHtml = msg.role === "assistant" && Array.isArray(msg.citations) && msg.citations.length
          ? `<footer class="riwi-msg__citations">${msg.citations.map((c) => `<span class="riwi-citation-chip">[${escapeHtml(typeof c === "string" ? c : c.ref || c.title || "K")}]</span>`).join(" ")}</footer>`
          : "";
        return `<article class="riwi-msg riwi-msg--${escapeHtml(msg.role)}">
          <header class="riwi-msg__meta">${badge}</header>
          <div class="riwi-msg__body">${escapeHtml(msg.content)}</div>
          ${citationsHtml}
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
    state.error = null;
    try {
      const payload = { message: trimmed };
      if (state.conversationId) payload.conversationId = state.conversationId;
      if (state.targetUserId && (state.role === "teacher" || state.role === "owner")) {
        payload.targetUserId = state.targetUserId;
      }
      const res = await adapter.sendChat(payload);
      state.conversationId = res.conversationId;
      state.messages.push(
        { role: "user", content: trimmed, createdAt: new Date().toISOString() },
        {
          role: "assistant",
          content: res.answer,
          createdAt: new Date().toISOString(),
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
    } catch (err) {
      state.error = err?.message || "request_failed";
      throw err;
    } finally {
      state.loading = false;
    }
  }

  async function loadTargets(cursor = null) {
    if (state.role !== "teacher" && state.role !== "admin" && state.role !== "owner") {
      return { items: [], nextCursor: null };
    }
    const page = await adapter.listTargets(cursor || state.nextTargetCursor);
    const items = Array.isArray(page?.items) ? page.items : [];
    state.targetOptions = cursor ? [...state.targetOptions, ...items] : items;
    state.nextTargetCursor = page?.nextCursor || null;
    return page;
  }

  async function clearConversation() {
    if (state.conversationId && typeof adapter.deleteConversation === "function") {
      await adapter.deleteConversation(state.conversationId);
    }
    state.conversationId = null;
    state.messages = [];
    state.feedbackSubmitted = false;
  }

  async function submitFeedback({ helpful, reason = "" }) {
    if (!state.conversationId) return null;
    const res = await adapter.submitFeedback({
      conversationId: state.conversationId,
      helpful: Boolean(helpful),
      reason: String(reason || "")
    });
    state.feedbackSubmitted = true;
    return res;
  }

  async function touchPresence() {
    if (typeof adapter.touchPresence === "function") {
      return adapter.touchPresence();
    }
    return { ok: true };
  }

  return {
    state,
    renderHtml,
    sendMessage,
    loadTargets,
    clearConversation,
    submitFeedback,
    touchPresence
  };
}

export function mount(ctx) {
  const {root, locale = 'uz', session, signal} = ctx;
  const role = session?.user?.role || 'student';
  const ctrl = createRiwiWorkspaceController({role, locale});
  const text = key => tRiwi(`riwi.chat.${key}`, locale);
  const transcript = h('div', {class: 'riwi-transcript', role: 'log', 'aria-live': 'polite', 'aria-label': text('conversation')});
  const input = h('textarea', {class: 'riwi-chat-input', rows: '1', maxlength: '4000',
    'aria-label': text('message'), placeholder: text('placeholder'),
    onInput: () => {input.style.height='auto';input.style.height=Math.min(input.scrollHeight,144)+'px';},
    onKeyDown: e => {
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}
    }
  });
  const sendBtn = h('button', {type: 'submit', class: 'riwi-send', 'aria-label': tRiwi('riwi.send', locale)},
    h('svg', {viewBox:'0 0 24 24',width:'22',height:'22','aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'},
      h('path',{d:'M12 19V5m-6 6 6-6 6 6'})));
  const status = h('p', {class:'riwi-status',role:'alert',hidden:true});
  const clearBtn = h('button', {type:'button',class:'riwi-clear',onClick:async()=>{
    if(ctrl.state.loading)return;
    try{await ctrl.clearConversation();renderMessages();status.hidden=true;input.focus();}
    catch{status.textContent=text('deleteError');status.hidden=false;}
  }}, tRiwi('riwi.clear',locale));
  let pending='';
  const greeting = () => h('div',{class:'riwi-welcome'},
    h('span',{class:'riwi-welcome__mark','aria-hidden':'true'},'R'),
    h('h2',{},text('welcome')),
    h('p',{},text('welcomeBody')),
    h('div',{class:'riwi-suggestions'},...['suggestGrammar','suggestReading','suggestVocabulary'].map(key=>
      h('button',{type:'button',class:'riwi-suggestion',onClick:()=>{input.value=text(key);input.focus();}},text(key)))));
  const bubble = m => {
    const isAssistant=m.role==='assistant';
    const time=new Date(m.createdAt);
    const clock=Number.isNaN(time.getTime())?'':new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{hour:'2-digit',minute:'2-digit'}).format(time);
    const citations=isAssistant&&m.citations?.length ? h('details',{class:'riwi-sources'},
      h('summary',{},text('sources')),
      h('ul',{},...m.citations.map(c=>h('li',{},typeof c==='string'?c:`${c.ref||'K'} · ${c.title||text('source')}`)))) : null;
    return h('article',{class:`riwi-msg riwi-msg--${m.role}`,'data-riwi-role':m.role},
      h('div',{class:'riwi-msg__body'},m.content),citations,
      clock?h('time',{class:'riwi-msg__time',datetime:m.createdAt},clock):null);
  };
  function renderMessages(){
    if(signal?.aborted)return;
    const messages=ctrl.state.messages;
    transcript.replaceChildren(...(messages.length||pending
      ? [h('div',{class:'riwi-date'},text('today')),...messages.map(bubble)]
      : [greeting()]));
    if(pending){
      transcript.append(bubble({role:'user',content:pending,createdAt:new Date().toISOString()}),
        h('div',{class:'riwi-typing',role:'status','aria-label':text('thinking')},h('span',{}),h('span',{}),h('span',{})));
    }
    transcript.setAttribute('aria-busy',String(ctrl.state.loading));
    sendBtn.disabled=ctrl.state.loading;clearBtn.disabled=ctrl.state.loading;input.readOnly=ctrl.state.loading;
    transcript.scrollTop=transcript.scrollHeight;
  }
  const form=h('form',{class:'riwi-composer',onSubmit:async e=>{
    e.preventDefault();
    if(ctrl.state.loading)return;
    const msg=input.value.trim();if(!msg)return;
    input.value='';input.style.height='auto';pending=msg;status.hidden=true;
    const work=ctrl.sendMessage(msg);renderMessages();
    try{await work;}
    catch{input.value=msg;status.textContent=text('sendError');status.hidden=false;}
    finally{pending='';renderMessages();}
  }},h('div',{class:'riwi-composer__field'},input,sendBtn),
    h('p',{class:'riwi-composer__hint'},text('hint')));
  root.append(h('section',{class:'riwi-workspace','data-route-usable':'riwi'},
    h('header',{class:'riwi-chat-header'},
      h('div',{class:'riwi-chat-identity'},h('span',{class:'riwi-avatar','aria-hidden':'true'},'R'),
        h('div',{},h('h1',{},'RIWI'),h('p',{},text('subtitle')))),clearBtn),
    transcript,status,form));
  renderMessages();
}
