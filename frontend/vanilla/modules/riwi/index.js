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
    replyLocale: locale === "en" ? "en" : "uz",
    theme: theme === "night" ? "night" : "day",
    conversationId: null,
    material: null,
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
        return `<article class="riwi-msg riwi-msg--${escapeHtml(msg.role)}">
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

  function newConversation() {
    state.conversationId = null;
    state.material = null;
    state.messages = [];
    state.feedbackSubmitted = false;
    state.targetUserId = null;
    state.error = null;
  }

  function localReply(key) {
    state.messages.push({role: 'assistant', content: tRiwi(`riwi.command.${key}`, state.replyLocale),
      createdAt: new Date().toISOString()});
    return {ok: true, localCommand: true};
  }

  function setReplyLocale(value) {
    if (state.loading || !['en','uz'].includes(value)) return false;
    state.replyLocale=value;
    return true;
  }

  async function sendMessage(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    if (state.loading) return null;
    let learningMessage = trimmed;
    if (trimmed.startsWith('/')) {
      const command = trimmed.slice(1).trim().toLowerCase().replace(/\s+/g, ' ');
      if (command === 'clear' || ['new', 'newchat', 'new chat'].includes(command)) {
        newConversation();
        return localReply(command === 'clear' ? 'cleared' : 'newChat');
      }
      if (['help', 'commands', '?'].includes(command)) return localReply('help');
      if (['examples', 'simple'].includes(command)) {
        if (!state.conversationId) return localReply('noTopic');
        learningMessage = tRiwi(`riwi.command.${command}Prompt`, state.replyLocale);
      } else return localReply('unknown');
    }
    state.loading = true;
    state.error = null;
    try {
      const payload = { message: learningMessage, replyLocale: state.replyLocale };
      if (state.material) payload.material = {kind: state.material.kind, id: state.material.id};
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
    newConversation();
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
    newConversation,
    setReplyLocale,
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
  const clearBtn = h('button', {type:'button',class:'riwi-clear',onClick:()=>{
    if(ctrl.state.loading)return;
    ctrl.newConversation();renderMessages();status.hidden=true;input.focus();
  }}, tRiwi('riwi.command.newChatButton',locale));
  let pending='';
  const runCommand = command => {
    if(ctrl.state.loading)return;
    input.value=command;commandMenu.open=false;form.requestSubmit();input.focus();
  };
  const commandMenu=h('details',{class:'riwi-command-menu'},
    h('summary',{},tRiwi('riwi.command.menu',locale)),
    h('div',{},...['/new chat','/clear','/examples','/simple','/help'].map(command=>
      h('button',{type:'button',onClick:()=>runCommand(command)},command))));
  const languageSummary=h('summary',{class:'riwi-reply-language',onClick:e=>{
    if(ctrl.state.loading)e.preventDefault();
  }});
  const languageMenu=h('details',{class:'riwi-language-menu'},languageSummary,
    h('div',{},...[['uz','O‘zbekcha'],['en','English']].map(([value,label])=>
      h('button',{type:'button','data-riwi-locale':value,onClick:()=>{
        if(!ctrl.setReplyLocale(value))return;
        languageMenu.open=false;renderMessages();languageSummary.focus();
      }},label))));
  const greeting = () => h('div',{class:'riwi-welcome'},
    h('span',{class:'riwi-welcome__mark','aria-hidden':'true'},'R'),
    h('h2',{},text('welcome')),
    h('p',{},text('welcomeBody')));
  const bubble = m => {
    const time=new Date(m.createdAt);
    const clock=Number.isNaN(time.getTime())?'':new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{hour:'2-digit',minute:'2-digit'}).format(time);
    return h('article',{class:`riwi-msg riwi-msg--${m.role}`,'data-riwi-role':m.role},
      h('div',{class:'riwi-msg__body'},m.content),
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
        h('div',{class:'riwi-typing',role:'status'},
          h('span',{class:'riwi-thinking-label'},text('thinking')),
          h('span',{class:'riwi-typing-dot','aria-hidden':'true'}),h('span',{class:'riwi-typing-dot','aria-hidden':'true'}),h('span',{class:'riwi-typing-dot','aria-hidden':'true'})));
    }
    transcript.setAttribute('aria-busy',String(ctrl.state.loading));
    sendBtn.disabled=ctrl.state.loading;clearBtn.disabled=ctrl.state.loading;input.readOnly=ctrl.state.loading;
    languageSummary.setAttribute('aria-disabled',String(ctrl.state.loading));
    languageSummary.textContent=`${tRiwi('riwi.command.replyLanguage',locale)}: ${ctrl.state.replyLocale==='en'?'ENG':'UZ'}`;
    languageMenu.querySelectorAll('button').forEach(button=>{
      button.disabled=ctrl.state.loading;
      button.setAttribute('aria-pressed',String(button.dataset.riwiLocale===ctrl.state.replyLocale));
    });
    commandMenu.querySelectorAll('button').forEach(button=>{button.disabled=ctrl.state.loading;});
    transcript.scrollTop=messages.length||pending?transcript.scrollHeight:0;
  }
  const form=h('form',{class:'riwi-composer',onSubmit:async e=>{
    e.preventDefault();
    if(ctrl.state.loading)return;
    const msg=input.value.trim();if(!msg)return;
    input.value='';input.style.height='auto';pending=msg.startsWith('/')?'':msg;status.hidden=true;
    const work=ctrl.sendMessage(msg);renderMessages();
    try{await work;}
    catch{input.value=msg;status.textContent=text('sendError');status.hidden=false;}
    finally{pending='';renderMessages();}
  }},h('div',{class:'riwi-composer__field'},input,sendBtn),
    h('div',{class:'riwi-composer__toolbar'},commandMenu,languageMenu),
    h('p',{class:'riwi-composer__hint'},text('hint')),
    h('p',{class:'riwi-composer__notice'},'RIWI is AI and can make mistakes, please check important info!'));
  root.append(h('section',{class:'riwi-workspace','data-route-usable':'riwi'},
    h('header',{class:'riwi-chat-header'},
      h('div',{class:'riwi-chat-identity'},h('span',{class:'riwi-avatar','aria-hidden':'true'},'R'),
        h('div',{},h('h1',{},'RIWI'),h('p',{},text('subtitle')))),clearBtn),
    transcript,status,form));
  renderMessages();
}
