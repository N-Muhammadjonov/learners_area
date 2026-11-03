import {h} from '../../js/native.js';
import {RiwiClientAdapter} from '../../js/adapters/riwi.js';
import {tRiwi} from '../../js/i18n/riwi_i18n.js';
import {FILE_ACCEPT,readFile,exportPayload,fileError} from '../../js/riwi-files.js';
import {anySignal} from '../../js/signals.js';
import {siteQuestion,siteContext} from '../../js/riwi-site-context.js';

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
  adapter = RiwiClientAdapter,
  readSiteContext = () => []
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
    attachments: [],
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
    state.attachments = [];
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
      if(state.attachments.length)payload.attachments=state.attachments.map(({name,kind,text})=>({name,kind,text}));
      if(siteQuestion(learningMessage)&&!state.attachments.length&&!state.material&&!state.targetUserId){
        const surfaces=readSiteContext();if(surfaces.length)payload.siteContext=surfaces;
      }
      const res = await adapter.sendChat(payload);
      let documentResult=null,documentError=null;
      if(res.documentAction){
        try{documentResult=(await adapter.exportDocument(await exportPayload(res.documentAction,state.attachments))).document;}
        catch(error){documentError=error?.code||error?.message||'document_export_failed';}
      }
      state.conversationId = res.conversationId;
      state.messages.push(
        { role: "user", content: trimmed, files:state.attachments.map(f=>f.name), createdAt: new Date().toISOString() },
        {
          role: "assistant",
          content: res.answer,
          createdAt: new Date().toISOString(),
          document: documentResult, documentError, documentAction:res.documentAction,
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
  const ctrl = createRiwiWorkspaceController({role, locale,readSiteContext:()=>siteContext(root.ownerDocument,window,role==='owner')});
  const text = key => tRiwi(`riwi.chat.${key}`, locale);
  const uz=locale==='uz';
  let filesReading=false,readAbort,lastFileCount=0;
  const downloadURLs=new Map();
  const transcript = h('div', {class: 'riwi-transcript', role: 'log', 'aria-live': 'polite', 'aria-label': text('conversation')});
  const conversation = h('div',{class:'riwi-conversation'},transcript,
    h('p',{class:'riwi-transcript__notice','aria-live':'off'},'RIWI is AI and can make mistakes, please check important info!'));
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
    if(ctrl.state.loading||filesReading)return;
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
  function downloadLink(m){
    const value=m.document;if(!value)return null;
    if(!downloadURLs.has(m)){
      const bytes=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));
      downloadURLs.set(m,URL.createObjectURL(new Blob([bytes],{type:value.mime})));
    }
    return h('a',{class:'riwi-document-download',href:downloadURLs.get(m),download:value.name},
      (uz?'Yuklab olish: ':'Download: ')+value.name);
  }
  async function rebuildDocument(m){
    if(ctrl.state.loading||filesReading)return;
    ctrl.state.loading=true;renderMessages();
    try{m.document=(await RiwiClientAdapter.exportDocument({mode:'create',format:m.documentAction.format,text:m.documentAction.text})).document;m.documentError=null;}
    catch(error){m.documentError=error?.code||error?.message;}
    finally{ctrl.state.loading=false;renderMessages();}
  }
  const bubble = m => {
    const time=new Date(m.createdAt);
    const clock=Number.isNaN(time.getTime())?'':new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{hour:'2-digit',minute:'2-digit'}).format(time);
    return h('article',{class:`riwi-msg riwi-msg--${m.role}`,'data-riwi-role':m.role},
      h('div',{class:'riwi-msg__body'},m.content),
      m.files?.length?h('div',{class:'riwi-message-files'},m.files.join(' · ')):null,
      downloadLink(m),
      m.documentError?h('div',{class:'riwi-document-error'},
        h('p',{},fileError(m.documentError,locale)),
        m.documentAction?.text?h('button',{type:'button',disabled:ctrl.state.loading,onClick:()=>rebuildDocument(m)},
          uz?'Matndan yangi nusxa yaratish':'Create a new copy from text'):null):null,
      clock?h('time',{class:'riwi-msg__time',datetime:m.createdAt},clock):null);
  };
  const filesList=h('div',{class:'riwi-file-list'}),fileStatus=h('p',{class:'riwi-file-status',role:'status',hidden:true});
  const editorInput=h('textarea',{class:'riwi-file-editor',maxlength:'60000','aria-label':uz?'Fayl matni':'File text',onInput:()=>{
    const item=ctrl.state.attachments[Number(editorSelect.value)];if(item)item.text=editorInput.value;
  }});
  const editorSelect=h('select',{'aria-label':uz?'Tahrirlanadigan fayl':'File to edit',onChange:()=>{
    editorInput.value=ctrl.state.attachments[Number(editorSelect.value)]?.text??'';
  }});
  async function exportEditor(format){
    if(ctrl.state.loading||filesReading)return;
    ctrl.state.loading=true;renderMessages();
    try{
      const result=await RiwiClientAdapter.exportDocument({mode:'create',format,text:editorInput.value});
      ctrl.state.messages.push({role:'assistant',content:uz?'Tahrirlangan matndan yangi nusxa tayyor 🙂':'A new copy of the edited text is ready 🙂',
        createdAt:new Date().toISOString(),document:result.document});
    }catch(error){fileStatus.hidden=false;fileStatus.textContent=fileError(error?.code||error?.message,locale);}
    finally{ctrl.state.loading=false;renderMessages();}
  }
  const editor=h('details',{class:'riwi-file-editor-panel',hidden:true},
    h('summary',{},uz?'Fayl matni va tahrirlash':'File text and editing'),editorSelect,editorInput,
    h('p',{},uz?'Quyidagi tugmalar matndan yangi hujjat yaratadi. Asl tuzilmani saqlash uchun chatda aniq almashtirishni so‘rang.':'These buttons create a new document from the text. Ask for an exact replacement in chat to preserve the original structure.'),
    h('div',{},...['txt','docx','pdf'].map(format=>h('button',{type:'button',onClick:()=>exportEditor(format)},format.toUpperCase()))));
  const fileInput=h('input',{type:'file',accept:FILE_ACCEPT,multiple:true,hidden:true,'aria-label':uz?'Fayl biriktirish':'Attach files',onChange:()=>{
    void addFiles([...fileInput.files]);fileInput.value='';
  }});
  const attachButton=h('button',{type:'button',class:'riwi-attach','aria-label':uz?'Fayl biriktirish':'Attach files',onClick:()=>fileInput.click()},'+');
  const cancelRead=h('button',{type:'button',hidden:true,onClick:()=>readAbort?.abort()},uz?'To‘xtatish':'Cancel');
  function renderFiles(){
    if(lastFileCount>0&&!ctrl.state.attachments.length&&!filesReading){fileStatus.hidden=true;editor.open=false;}
    lastFileCount=ctrl.state.attachments.length;
    filesList.replaceChildren(...ctrl.state.attachments.map((item,index)=>h('div',{class:'riwi-file-chip'},
      h('span',{},item.name),h('button',{type:'button',disabled:ctrl.state.loading||filesReading,'aria-label':(uz?'Olib tashlash: ':'Remove: ')+item.name,
        onClick:()=>{ctrl.state.attachments.splice(index,1);renderMessages();}},'×'))));
    editor.hidden=!ctrl.state.attachments.length;
    const selected=Math.min(Number(editorSelect.value)||0,Math.max(0,ctrl.state.attachments.length-1));
    editorSelect.replaceChildren(...ctrl.state.attachments.map((item,index)=>h('option',{value:String(index),selected:index===selected},item.name)));
    if(document.activeElement!==editorInput)editorInput.value=ctrl.state.attachments[selected]?.text??'';
    attachButton.disabled=ctrl.state.loading||filesReading;cancelRead.hidden=!filesReading;
    editor.querySelectorAll('button,select,textarea').forEach(n=>{n.disabled=ctrl.state.loading||filesReading;});
  }
  async function addFiles(files){
    if(ctrl.state.loading||filesReading||!files.length)return;
    if(ctrl.state.attachments.length+files.length>4){fileStatus.hidden=false;fileStatus.textContent=uz?'Bir vaqtda 4 tagacha fayl yuboring.':'Attach up to 4 files at a time.';return;}
    readAbort=new AbortController();const lifetime=signal?anySignal([signal,readAbort.signal]):readAbort.signal;
    const timer=setTimeout(()=>readAbort.abort(),180000);filesReading=true;fileStatus.hidden=false;renderMessages();
    try{
      for(const file of files){
        const item=await readFile(file,{signal:lifetime,onProgress:progress=>{
          if(!lifetime.aborted)fileStatus.textContent=(uz?'O‘qilyapti: ':'Reading: ')+file.name+(progress.page?` · ${progress.page}/${progress.pages}`:` · ${Math.round((progress.progress??0)*100)}%`);
        }});
        if(ctrl.state.attachments.reduce((n,f)=>n+f.text.length,0)+item.text.length>120000)throw Error('file_text_limit');
        ctrl.state.attachments.push(item);
      }
      fileStatus.textContent=uz?'Fayl matni o‘qildi. Savolingizni yozing yoki matnni tekshirib tahrirlang.':'File text read. Ask your question or review and edit the text.';
    }catch(error){if(!signal?.aborted)fileStatus.textContent=error?.name==='AbortError'?(uz?'O‘qish to‘xtatildi.':'Reading cancelled.'):fileError(error?.message,locale);}
    finally{clearTimeout(timer);filesReading=false;renderMessages();}
  }
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
    const busy=ctrl.state.loading||filesReading;
    sendBtn.disabled=busy;clearBtn.disabled=busy;input.readOnly=busy;
    languageSummary.setAttribute('aria-disabled',String(busy));
    languageSummary.textContent=`${tRiwi('riwi.command.replyLanguage',locale)}: ${ctrl.state.replyLocale==='en'?'ENG':'UZ'}`;
    languageMenu.querySelectorAll('button').forEach(button=>{
      button.disabled=busy;
      button.setAttribute('aria-pressed',String(button.dataset.riwiLocale===ctrl.state.replyLocale));
    });
    commandMenu.querySelectorAll('button').forEach(button=>{button.disabled=busy;});
    transcript.scrollTop=messages.length||pending?transcript.scrollHeight:0;
    for(const [message,url]of downloadURLs)if(!messages.includes(message)){URL.revokeObjectURL(url);downloadURLs.delete(message);}
    renderFiles();
  }
  const form=h('form',{class:'riwi-composer',onSubmit:async e=>{
    e.preventDefault();
    if(ctrl.state.loading||filesReading)return;
    const msg=input.value.trim()||(ctrl.state.attachments.length?(uz?'Faylni o‘qib, asosiy mazmunini ko‘rsat.':'Read the file and show its main content.'):'');if(!msg)return;
    input.value='';input.style.height='auto';pending=msg.startsWith('/')?'':msg;status.hidden=true;
    const work=ctrl.sendMessage(msg);renderMessages();
    try{await work;}
    catch{input.value=msg;status.textContent=text('sendError');status.hidden=false;}
    finally{pending='';renderMessages();}
  }},filesList,fileStatus,cancelRead,h('div',{class:'riwi-composer__field'},attachButton,input,sendBtn),fileInput,editor,
    h('div',{class:'riwi-composer__toolbar'},commandMenu,languageMenu));
  root.append(h('section',{class:'riwi-workspace','data-route-usable':'riwi'},
    h('header',{class:'riwi-chat-header'},
      h('div',{class:'riwi-chat-identity'},h('span',{class:'riwi-avatar','aria-hidden':'true'},'R'),
        h('div',{},h('h1',{},'RIWI'),h('p',{},text('subtitle')))),clearBtn),
    conversation,status,form));
  const dropHost=root.querySelector('.riwi-workspace');
  dropHost.addEventListener('dragover',event=>{if([...event.dataTransfer?.types??[]].includes('Files')){event.preventDefault();dropHost.classList.add('riwi-drop-active');}},{signal});
  dropHost.addEventListener('dragleave',event=>{if(!dropHost.contains(event.relatedTarget))dropHost.classList.remove('riwi-drop-active');},{signal});
  dropHost.addEventListener('drop',event=>{if(event.dataTransfer?.files?.length){event.preventDefault();dropHost.classList.remove('riwi-drop-active');void addFiles([...event.dataTransfer.files]);}},{signal});
  input.addEventListener('paste',event=>{if(event.clipboardData?.files?.length){event.preventDefault();void addFiles([...event.clipboardData.files]);}},{signal});
  signal?.addEventListener('abort',()=>{readAbort?.abort();for(const url of downloadURLs.values())URL.revokeObjectURL(url);downloadURLs.clear();},{once:true});
  renderMessages();
}
