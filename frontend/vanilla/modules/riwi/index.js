import {h} from '../../js/native.js';
import {RiwiClientAdapter} from '../../js/adapters/riwi.js';
import {tRiwi} from '../../js/i18n/riwi_i18n.js';
import {FILE_ACCEPT,stageFile,readFile,exportPayload,fileError} from '../../js/riwi-files.js';
import {anySignal} from '../../js/signals.js';
import {siteQuestion,siteContext,safeNavigation} from '../../js/riwi-site-context.js';
import {createLocalDictation,dictationError} from '../../js/riwi-dictation.js';

export const RIWI_WORKSPACE_ROUTE = "/app/riwi";
export const RIWI_MESSAGE_TTL_MS=7*24*60*60*1000;
export const RIWI_CONVERSATION_MAX_CHARS=128000;

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
  readSiteContext = () => [],
  now = () => Date.now()
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
    chatSizing:null,
    limitReached:false,
    loading: false,
    feedbackSubmitted: false,
    error: null
  };
  let serverOffset=0;
  const currentTime=()=>now()+serverOffset;
  function expireMessages(){
    const cutoff=currentTime()-RIWI_MESSAGE_TTL_MS,before=state.messages.length;
    state.messages=state.messages.filter(m=>Date.parse(m.createdAt)>cutoff);
    if(before!==state.messages.length){state.chatSizing=null;state.limitReached=false;}
    state.attachments=state.attachments.filter(f=>!f.sentAt||Date.parse(f.sentAt)>cutoff);
    if(before&&!state.messages.length){state.conversationId=null;state.material=null;state.targetUserId=null;state.feedbackSubmitted=false;}
    return before!==state.messages.length;
  }
  function nextExpiry(){return state.messages.length?state.messages.reduce((oldest,m)=>Math.min(oldest,Date.parse(m.createdAt)),Infinity)+RIWI_MESSAGE_TTL_MS-currentTime():null;}
  function getChatSizing(){
    const local=state.messages.reduce((n,m)=>n+[...String(m.content??'')].length,0),max=state.chatSizing?.maxChars??RIWI_CONVERSATION_MAX_CHARS;
    const used=Math.max(local,state.chatSizing?.usedChars??0);
    return {usedChars:used,maxChars:max,estimatedTokens:Math.ceil(used/4),full:state.limitReached||used>=max};
  }
  function limitError(){state.limitReached=true;const error=new Error('conversation_limit_reached');error.code=error.message;return error;}

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

  async function newConversation() {
    const previous=state.conversationId;
    state.conversationId = null;
    state.material = null;
    state.messages = [];
    state.attachments = [];
    state.chatSizing=null;state.limitReached=false;
    state.feedbackSubmitted = false;
    state.targetUserId = null;
    state.error = null;
    if(previous&&typeof adapter.archiveConversation==='function'){
      state.loading=true;
      try{await adapter.archiveConversation(previous);}
      catch(error){if(error?.code!=='not_found'){state.error='archive_failed';throw error;}}
      finally{state.loading=false;}
    }
  }

  function localReply(key) {
    const content=tRiwi(`riwi.command.${key}`, state.replyLocale),sizing=getChatSizing();
    if(sizing.usedChars+[...content].length>sizing.maxChars)throw limitError();
    state.messages.push({role: 'assistant', content,
      createdAt: new Date(currentTime()).toISOString()});
    return {ok: true, localCommand: true};
  }

  function setReplyLocale(value) {
    if (state.loading || !['en','uz'].includes(value)) return false;
    state.replyLocale=value;
    return true;
  }

  async function sendMessage(text) {
    expireMessages();
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    if (state.loading) return null;
    let learningMessage = trimmed;
    if (trimmed.startsWith('/')) {
      const command = trimmed.slice(1).trim().toLowerCase().replace(/\s+/g, ' ');
      if (command === 'clear' || ['new', 'newchat', 'new chat'].includes(command)) {
        await newConversation();
        return localReply(command === 'clear' ? 'cleared' : 'newChat');
      }
      if (['help', 'commands', '?'].includes(command)) return localReply('help');
      if (['examples', 'simple'].includes(command)) {
        if (!state.conversationId) return localReply('noTopic');
        learningMessage = tRiwi(`riwi.command.${command}Prompt`, state.replyLocale);
      } else return localReply('unknown');
    }
    const sizing=getChatSizing();
    if(sizing.full||sizing.usedChars+[...learningMessage].length>sizing.maxChars)throw limitError();
    state.loading = true;
    state.error = null;
    try {
      const payload = { message: learningMessage, replyLocale: state.replyLocale };
      if (state.material) payload.material = {kind: state.material.kind, id: state.material.id};
      if (state.conversationId) payload.conversationId = state.conversationId;
      if (state.targetUserId && (state.role === "teacher" || state.role === "owner")) {
        payload.targetUserId = state.targetUserId;
      }
      const websiteQuestion=siteQuestion(learningMessage);
      const fileQuestion=/fayl(?:dagi|ni|dan|ning)|rasm(?:dagi|ni|dan|ning)|\b(?:this|attached|uploaded).{0,20}(?:file|image|photo|document)|\bpdf\b|\bdocx\b/i.test(learningMessage);
      const useFiles=state.attachments.length&&(!websiteQuestion||fileQuestion||state.attachments.some(f=>!f.sent));
      if(useFiles)payload.attachments=state.attachments.map(({name,kind,text})=>({name,kind,text}));
      if(websiteQuestion&&!useFiles&&!state.material&&!state.targetUserId){
        const surfaces=readSiteContext();if(surfaces.length)payload.siteContext=surfaces;
      }
      const res = await adapter.sendChat(payload);
      if(Number.isSafeInteger(res.chatSizing?.usedChars)&&Number.isSafeInteger(res.chatSizing?.maxChars)&&res.chatSizing.usedChars>=0&&res.chatSizing.maxChars>0){
        state.chatSizing=res.chatSizing;state.limitReached=!!res.chatSizing.full;
      }
      const serverTime=Date.parse(res.serverTime);if(Number.isFinite(serverTime))serverOffset=serverTime-now();
      const createdAt=Number.isFinite(Date.parse(res.messageCreatedAt))?res.messageCreatedAt:new Date(currentTime()).toISOString();
      let documentResult=null,documentError=null;
      if(res.documentAction){
        try{documentResult=(await adapter.exportDocument(await exportPayload(res.documentAction,state.attachments))).document;}
        catch(error){documentError=error?.code||error?.message||'document_export_failed';}
      }
      state.conversationId = res.conversationId;
      state.messages.push(
        { role: "user", content: trimmed, files:state.attachments.filter(f=>!f.sent).map(({name,kind,previewUrl})=>({name,kind,previewUrl})), createdAt },
        {
          role: "assistant",
          content: res.answer,
          createdAt: new Date(Date.parse(createdAt)+1).toISOString(),
          document: documentResult, documentError, documentAction:res.documentAction,
          provenance: res.provenance,
          citations: res.citations || [],
          navigationLinks: safeNavigation(res.navigationLinks),
          reportSnapshot: res.reportSnapshot || null
        }
      );
      state.attachments.forEach(item=>{item.sent=true;item.sentAt??=createdAt;});
      if (res.roleSurface && Array.isArray(res.roleSurface.targetOptions)) {
        state.targetOptions = res.roleSurface.targetOptions;
        state.nextTargetCursor = res.roleSurface.nextCursor || null;
      }
      return res;
    } catch (err) {
      if(err?.code==='conversation_limit_reached')state.limitReached=true;
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
    state.conversationId=null;await newConversation();
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
    touchPresence,
    expireMessages,nextExpiry,getChatSizing
  };
}

export function mount(ctx,{readAttachment=readFile,dictationFactory=createLocalDictation,now=()=>Date.now()}={}) {
  const {root, locale = 'uz', session, signal} = ctx;
  const role = session?.user?.role || 'student';
  const ctrl = createRiwiWorkspaceController({role, locale,now,readSiteContext:()=>siteContext(root.ownerDocument,window,role==='owner')});
  const text = key => tRiwi(`riwi.chat.${key}`, locale);
  const uz=locale==='uz';
  let filesReading=false,readAbort,lastFileCount=0,voiceBusy=false,voicePhase='idle',voiceProgress=0,expiryTimer;
  let slashIndex=0,slashItems=[],slashDismissed=false;
  const commands=['/new chat','/clear','/examples','/simple','/help'];
  const commandHints=uz?['Oldingi kontekstsiz yangi suhbat','Suhbat kontekstini tozalash','Avvalgi mavzudan misollar','Avvalgi mavzuni soddaroq tushuntirish','RIWI buyruqlari haqida yordam']:
    ['Start without the previous context','Clear conversation context','Examples for the previous topic','Explain the previous topic more simply','Help with RIWI commands'];
  const slashList=h('div',{class:'riwi-slash-suggestions',id:'riwi-slash-suggestions',role:'listbox',hidden:true,'aria-label':uz?'Buyruq tanlang':'Choose a command'});
  const downloadURLs=new Map(),attachmentURLs=new Set();
  const transcript = h('div', {class: 'riwi-transcript', role: 'log', 'aria-live': 'polite', 'aria-label': text('conversation')});
  const conversation = h('div',{class:'riwi-conversation'},transcript,
    h('p',{class:'riwi-transcript__notice','aria-live':'off'},'RIWI is AI and can make mistakes, please check important info!'));
  const input = h('textarea', {class: 'riwi-chat-input', rows: '1', maxlength: '4000',
    'aria-label': text('message'), placeholder: text('placeholder'),
    'aria-autocomplete':'list','aria-controls':'riwi-slash-suggestions','aria-expanded':'false',
    onInput: () => {
      const caret=input.selectionStart,prefix=input.value.slice(0,caret);
      if(!ctrl.state.loading&&!filesReading&&!voiceBusy&&/(?:^|\s)@$/.test(prefix)){
        input.setRangeText('',caret-1,caret,'end');fileInput.click();
      }
      input.style.height='auto';input.style.height=Math.min(input.scrollHeight,144)+'px';slashDismissed=false;slashIndex=0;drawSlash();
    },
    onKeyDown: e => {
      if(e.isComposing)return;
      if(e.key==='@'&&!ctrl.state.loading&&!filesReading&&!voiceBusy&&/(?:^|\s)$/.test(input.value.slice(0,input.selectionStart))){e.preventDefault();fileInput.click();return;}
      if(!slashList.hidden){
        if(e.key==='Escape'){e.preventDefault();slashDismissed=true;drawSlash();return;}
        if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();slashIndex=(slashIndex+(e.key==='ArrowDown'?1:-1)+slashItems.length)%slashItems.length;drawSlash();return;}
        if((e.key==='Tab'||e.key==='Enter'&&!e.shiftKey)&&!commands.includes(input.value.trim())){e.preventDefault();selectSlash(slashItems[slashIndex]);return;}
      }
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}
    }
  });
  function selectSlash(command){
    input.value=command;slashDismissed=true;drawSlash();input.focus();input.setSelectionRange(command.length,command.length);
  }
  function drawSlash(){
    const value=input.value.trimStart().toLowerCase();
    slashItems=!slashDismissed&&!ctrl.state.loading&&!filesReading&&!voiceBusy&&/^\/[a-z ]*$/.test(value)?commands.filter(command=>command.startsWith(value)):[];
    slashList.hidden=!slashItems.length;input.setAttribute('aria-expanded',String(!slashList.hidden));
    if(slashList.hidden){input.removeAttribute('aria-activedescendant');slashList.replaceChildren();return;}
    slashIndex=Math.min(slashIndex,slashItems.length-1);input.setAttribute('aria-activedescendant',`riwi-command-option-${slashIndex}`);
    slashList.replaceChildren(...slashItems.map((command,index)=>h('button',{type:'button',role:'option',id:`riwi-command-option-${index}`,'aria-selected':String(index===slashIndex),
      onMouseDown:event=>event.preventDefault(),onClick:()=>selectSlash(command)},h('strong',{},command),h('span',{},commandHints[commands.indexOf(command)]))));
  }
  const sendBtn = h('button', {type: 'submit', class: 'riwi-send', 'aria-label': tRiwi('riwi.send', locale)},
    h('svg', {viewBox:'0 0 24 24',width:'22',height:'22','aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'},
      h('path',{d:'M12 19V5m-6 6 6-6 6 6'})));
  const status = h('p', {class:'riwi-status',role:'alert',hidden:true});
  const sizeLabel=h('span',{class:'riwi-chat-size',hidden:true});
  const voiceLabel=h('span'),voiceMeter=h('progress',{max:'1',value:'0','aria-label':uz?'Nutq modeli yuklanmoqda':'Loading local speech model'});
  const voiceDraft=h('textarea',{class:'riwi-voice-draft',readonly:true,hidden:true,'aria-label':uz?'Ovozdan olingan uzun matn':'Long voice transcript'});
  let dictation;
  const voiceLanguage=h('select',{'aria-label':uz?'Ovoz tili':'Voice language',onChange:()=>dictation.setLanguage(voiceLanguage.value)},
    ...[['auto',uz?'Til: avto':'Language: auto'],['uz',uz?'O‘zbekcha (sinov)':'Uzbek (experimental)'],['en','English']].map(([value,label])=>h('option',{value},label)));
  const voicePanel=h('div',{class:'riwi-voice-panel',role:'status',hidden:true},voiceLabel,voiceLanguage,voiceMeter,voiceDraft);
  const micButton=h('button',{type:'button',class:'riwi-microphone','aria-label':uz?'Ovoz bilan yozish':'Voice input',onClick:()=>{
    if(ctrl.state.loading||filesReading)return;
    if(dictation.phase==='recording')void dictation.stop();else if(dictation.phase==='idle')void dictation.start();
  }});
  function drawMic(){
    micButton.replaceChildren(h('svg',{viewBox:'0 0 24 24',width:'21',height:'21',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','aria-hidden':'true'},
      ...(voicePhase==='recording'?[h('rect',{x:'6',y:'6',width:'12',height:'12',rx:'2',fill:'currentColor',stroke:'none'})]:
        [h('rect',{x:'9',y:'2',width:'6',height:'12',rx:'3'}),h('path',{d:'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8'})])));
    micButton.setAttribute('aria-label',voicePhase==='recording'?(uz?'Yozishni to‘xtatish':'Stop recording'):(uz?'Ovoz bilan yozish':'Voice input'));
    micButton.setAttribute('aria-pressed',String(voicePhase==='recording'));micButton.classList.toggle('is-recording',voicePhase==='recording');
    micButton.disabled=ctrl.state.loading||filesReading||['opening','transcribing'].includes(voicePhase);
  }
  dictation=dictationFactory({signal,onState:state=>{
    const changed=voicePhase!==state.phase;voicePhase=state.phase;voiceBusy=voicePhase!=='idle';
    if(Number.isFinite(state.progress))voiceProgress=state.progress;
    voicePanel.hidden=!voiceBusy&&!state.error;voiceDraft.hidden=true;voiceLanguage.hidden=!voiceBusy;
    voiceLanguage.disabled=voicePhase==='transcribing';voiceMeter.hidden=!voiceBusy||voiceProgress>=1;voiceMeter.value=voiceProgress;
    const elapsed=Math.max(0,Math.floor((state.elapsedMs??0)/1000)),clock=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
    voiceLabel.textContent=state.error?dictationError(state.error,locale):voicePhase==='opening'?(uz?'Mikrofon ochilmoqda…':'Opening microphone…'):
      voicePhase==='recording'?(uz?`Yozilmoqda ${clock}`:`Recording ${clock}`):(uz?'Qurilmada matnga aylantiryapman…':'Transcribing on this device…');
    if(voiceBusy&&voiceProgress<1)voiceLabel.textContent+=(uz?' · Nutq modeli ':' · Speech model ')+Math.round(voiceProgress*100)+'%';
    drawMic();if(changed||state.error)renderMessages();
  },onText:text=>{
    const next=[input.value.trim(),text.trim()].filter(Boolean).join(' ');
    if(next.length>4000){voicePanel.hidden=false;voiceLanguage.hidden=true;voiceMeter.hidden=true;voiceDraft.hidden=false;voiceDraft.value=text;voiceLabel.textContent=uz?'Matn yozish chegarasidan oshdi. Ovoz matnidan kerakli qismini ko‘chiring.':'The draft would exceed the limit. Copy the needed part of the voice transcript.';return;}
    input.value=next;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,144)+'px';input.focus();
    voicePanel.hidden=false;voiceLanguage.hidden=true;voiceMeter.hidden=true;
    voiceLabel.textContent=uz?'Matn qurilmada tayyorlandi. Yuborishdan oldin tekshiring; o‘zbekcha ovozda xatolar ko‘proq bo‘lishi mumkin.':'Transcribed on this device. Review before sending; Uzbek speech may contain more errors.';
  }});
  drawMic();
  const clearBtn = h('button', {type:'button',class:'riwi-clear',onClick:async()=>{
    if(ctrl.state.loading||filesReading||voiceBusy)return;
    input.value=ctrl.getChatSizing().full?input.value:'';slashDismissed=true;voicePanel.hidden=true;
    const clearing=ctrl.newConversation();renderMessages();status.hidden=true;
    try{await clearing;}catch{status.textContent=uz?'Yangi suhbat ochildi. Oldingi chatni arxivlash uchun ulanishni tekshiring.':'New chat opened. Check your connection to archive the previous chat.';status.hidden=false;}
    finally{renderMessages();input.focus();}
  }}, tRiwi('riwi.command.newChatButton',locale));
  let pending=null,readProgress='';
  const runCommand = command => {
    if(ctrl.state.loading||voiceBusy)return;
    input.value=command;commandMenu.open=false;form.requestSubmit();input.focus();
  };
  const commandMenu=h('details',{class:'riwi-command-menu'},
    h('summary',{},tRiwi('riwi.command.menu',locale)),
    h('div',{},...commands.map(command=>
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
    if(ctrl.state.loading||filesReading||voiceBusy)return;
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
      safeNavigation(m.navigationLinks).length?h('nav',{class:'riwi-navigation','aria-label':uz?'Bo‘limni ochish':'Open a section'},
        ...safeNavigation(m.navigationLinks).map(item=>h('a',{href:item.href},item.label))):null,
      m.files?.length?h('div',{class:'riwi-message-files'},...m.files.map(item=>{
        const f=typeof item==='string'?{name:item}:item;
        return f.previewUrl?h('figure',{class:'riwi-message-image'},h('img',{src:f.previewUrl,alt:f.name}),h('figcaption',{},f.name)):
          h('span',{class:'riwi-message-file'},f.name);
      })):null,
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
    if(ctrl.state.loading||filesReading||voiceBusy)return;
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
    filesList.replaceChildren(...ctrl.state.attachments.flatMap((item,index)=>item.sent?[]:[h('div',{class:'riwi-file-chip'},
      item.previewUrl?h('img',{class:'riwi-file-preview',src:item.previewUrl,alt:item.name}):null,
      h('span',{},item.name),h('button',{type:'button',disabled:ctrl.state.loading||filesReading,'aria-label':(uz?'Olib tashlash: ':'Remove: ')+item.name,
        onClick:()=>{ctrl.state.attachments.splice(index,1);renderMessages();}},'×'))]));
    editor.hidden=!ctrl.state.attachments.some(item=>typeof item.text==='string'&&item.text.length);
    const selected=Math.min(Number(editorSelect.value)||0,Math.max(0,ctrl.state.attachments.length-1));
    editorSelect.replaceChildren(...ctrl.state.attachments.map((item,index)=>h('option',{value:String(index),selected:index===selected},item.name)));
    if(document.activeElement!==editorInput)editorInput.value=ctrl.state.attachments[selected]?.text??'';
    attachButton.disabled=ctrl.state.loading||filesReading||voiceBusy;cancelRead.hidden=!filesReading;
    editor.querySelectorAll('button,select,textarea').forEach(n=>{n.disabled=ctrl.state.loading||filesReading||voiceBusy;});
  }
  function addFiles(files){
    if(ctrl.state.loading||filesReading||voiceBusy||!files.length)return;
    if(ctrl.state.attachments.length+files.length>4){fileStatus.hidden=false;fileStatus.textContent=uz?'Bir vaqtda 4 tagacha fayl yuboring.':'Attach up to 4 files at a time.';return;}
    try{
      const staged=files.map(stageFile);
      for(const item of staged)if(item.kind==='image'){
        try{item.previewUrl=URL.createObjectURL(item.file);attachmentURLs.add(item.previewUrl);}catch{}
      }
      ctrl.state.attachments.push(...staged);
      fileStatus.hidden=true;renderMessages();
    }catch(error){fileStatus.hidden=false;fileStatus.textContent=fileError(error.message,locale);}
  }
  async function prepareFiles(){
    if(!ctrl.state.attachments.some(item=>item.text===null))return;
    readAbort=new AbortController();const lifetime=signal?anySignal([signal,readAbort.signal]):readAbort.signal;
    const timer=setTimeout(()=>readAbort.abort(),180000);filesReading=true;fileStatus.hidden=true;renderMessages();
    try{
      for(const item of ctrl.state.attachments){
        if(item.text!==null)continue;
        readProgress=item.name;renderMessages();
        try{Object.assign(item,await readAttachment(item.file,{signal:lifetime,onProgress:progress=>{
          if(!lifetime.aborted){readProgress=item.name+(progress.page?` · ${progress.page}/${progress.pages}`:` · ${Math.round((progress.progress??0)*100)}%`);renderMessages();}
        }}));}
        catch(error){if(item.kind==='image'&&['file_no_text','invalid_image'].includes(error.message)){item.text='';}else throw error;}
        if(ctrl.state.attachments.reduce((n,f)=>n+(f.text?.length??0),0)>120000)throw Error('file_text_limit');
      }
    }finally{clearTimeout(timer);filesReading=false;readProgress='';}
  }
  function renderMessages(){
    if(signal?.aborted)return;
    clearTimeout(expiryTimer);ctrl.expireMessages();const deadline=ctrl.nextExpiry();
    if(deadline!==null)expiryTimer=setTimeout(()=>renderMessages(),Math.max(1,deadline));
    const messages=ctrl.state.messages;
    transcript.replaceChildren(...(messages.length||pending
      ? [h('div',{class:'riwi-date'},text('today')),...messages.map(bubble)]
      : [greeting()]));
    if(pending){
      transcript.append(bubble(pending),
        h('div',{class:'riwi-typing',role:'status'},
          h('span',{class:'riwi-thinking-label'},text('thinking')+(filesReading&&readProgress?' '+readProgress:'')),
          h('span',{class:'riwi-typing-dot','aria-hidden':'true'}),h('span',{class:'riwi-typing-dot','aria-hidden':'true'}),h('span',{class:'riwi-typing-dot','aria-hidden':'true'}),cancelRead));
    }
    transcript.setAttribute('aria-busy',String(ctrl.state.loading));
    const busy=ctrl.state.loading||filesReading||voiceBusy;
    const sizing=ctrl.getChatSizing();sizeLabel.hidden=!messages.length&&!sizing.full;
    sizeLabel.textContent=(uz?'Suhbat hajmi: ':'Chat size: ')+Math.min(100,Math.floor(sizing.usedChars/sizing.maxChars*100))+'%';
    sizeLabel.title=uz?`${sizing.usedChars.toLocaleString('uz-UZ')} / ${sizing.maxChars.toLocaleString('uz-UZ')} belgi; taxminan ${sizing.estimatedTokens} token. Limitda yangi suhbat oching.`:`${sizing.usedChars.toLocaleString('en-GB')} / ${sizing.maxChars.toLocaleString('en-GB')} characters; about ${sizing.estimatedTokens} tokens. Start a new chat at the limit.`;
    sendBtn.disabled=busy||sizing.full;clearBtn.disabled=busy;input.readOnly=ctrl.state.loading||filesReading;drawMic();
    languageSummary.setAttribute('aria-disabled',String(busy));
    languageSummary.textContent=`${tRiwi('riwi.command.replyLanguage',locale)}: ${ctrl.state.replyLocale==='en'?'ENG':'UZ'}`;
    languageMenu.querySelectorAll('button').forEach(button=>{
      button.disabled=busy;
      button.setAttribute('aria-pressed',String(button.dataset.riwiLocale===ctrl.state.replyLocale));
    });
    commandMenu.querySelectorAll('button').forEach(button=>{button.disabled=busy;});
    drawSlash();
    transcript.scrollTop=messages.length||pending?transcript.scrollHeight:0;
    for(const [message,url]of downloadURLs)if(!messages.includes(message)){URL.revokeObjectURL(url);downloadURLs.delete(message);}
    const used=new Set([...ctrl.state.attachments,...messages.flatMap(m=>m.files??[]),...(pending?.files??[])].map(f=>f?.previewUrl).filter(Boolean));
    for(const url of attachmentURLs)if(!used.has(url)){URL.revokeObjectURL(url);attachmentURLs.delete(url);}
    renderFiles();
  }
  const form=h('form',{class:'riwi-composer',onSubmit:async e=>{
    e.preventDefault();
    if(ctrl.state.loading||filesReading||voiceBusy||pending)return;
    slashDismissed=true;drawSlash();
    const msg=input.value.trim()||(ctrl.state.attachments.some(f=>!f.sent)?(uz?'Faylni o‘qib, asosiy mazmunini ko‘rsat.':'Read the file and show its main content.'):'');if(!msg)return;
    if(ctrl.getChatSizing().full&&!msg.startsWith('/')){status.textContent=text('chatLimit');status.hidden=false;return;}
    input.value='';input.style.height='auto';pending=msg.startsWith('/')?null:{role:'user',content:msg,files:ctrl.state.attachments.filter(f=>!f.sent).map(({name,kind,previewUrl})=>({name,kind,previewUrl})),createdAt:new Date().toISOString()};status.hidden=true;
    // Publish the user's bubble and Thinking before loading parsers/OCR.
    filesReading=!!pending&&ctrl.state.attachments.some(item=>item.text===null);renderMessages();
    try{if(pending&&ctrl.state.attachments.some(item=>item.text===null))await prepareFiles();const work=ctrl.sendMessage(msg);renderMessages();await work;}
    catch(error){
      if(signal?.aborted)return;
      input.value=msg;
      if(pending&&!ctrl.state.loading&&ctrl.state.attachments.some(item=>item.text===null)){
        ctrl.state.messages.push(pending,{role:'assistant',content:error?.name==='AbortError'?(uz?'Faylni o‘qish to‘xtatildi.':'File reading was cancelled.'):fileError(error?.message,locale),createdAt:new Date().toISOString()});
      }else{status.textContent=text(error?.code==='conversation_limit_reached'?'chatLimit':'sendError');status.hidden=false;}
    }
    finally{pending=null;filesReading=false;renderMessages();}
  }},slashList,filesList,fileStatus,h('div',{class:'riwi-composer__field'},attachButton,input,micButton,sendBtn),voicePanel,fileInput,editor,
    h('div',{class:'riwi-composer__toolbar'},commandMenu,languageMenu));
  root.append(h('section',{class:'riwi-workspace','data-route-usable':'riwi'},
    h('header',{class:'riwi-chat-header'},
      h('div',{class:'riwi-chat-identity'},h('span',{class:'riwi-avatar','aria-hidden':'true'},'R'),
        h('div',{},h('h1',{},'RIWI'),h('p',{},text('subtitle')))),h('div',{class:'riwi-chat-actions'},clearBtn,sizeLabel)),
    conversation,status,form));
  const dropHost=root.querySelector('.riwi-workspace');
  dropHost.addEventListener('dragover',event=>{if([...event.dataTransfer?.types??[]].includes('Files')){event.preventDefault();dropHost.classList.add('riwi-drop-active');}},{signal});
  dropHost.addEventListener('dragleave',event=>{if(!dropHost.contains(event.relatedTarget))dropHost.classList.remove('riwi-drop-active');},{signal});
  dropHost.addEventListener('drop',event=>{if(event.dataTransfer?.files?.length){event.preventDefault();dropHost.classList.remove('riwi-drop-active');void addFiles([...event.dataTransfer.files]);}},{signal});
  input.addEventListener('paste',event=>{if(event.clipboardData?.files?.length){event.preventDefault();void addFiles([...event.clipboardData.files]);}},{signal});
  document.addEventListener('pointerdown',event=>{if(!form.contains(event.target)){slashDismissed=true;drawSlash();}},{signal});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderMessages();},{signal});
  signal?.addEventListener('abort',()=>{clearTimeout(expiryTimer);dictation.cancel();readAbort?.abort();for(const url of [...downloadURLs.values(),...attachmentURLs])URL.revokeObjectURL(url);downloadURLs.clear();attachmentURLs.clear();},{once:true});
  renderMessages();
}
