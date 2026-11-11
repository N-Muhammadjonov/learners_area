import {typingControlIcon} from './typing-controls.js';
import {el,button,card,post,safeArray} from './shared.js';

// Source: src/components/writing/TypingTrainer.tsx and typing-keystrokes.ts.
// Only the server scores signed texts. These browser counters are for presentation.
const BACKSPACE='\b',DELETE_WORD='\x17';
const PRESETS=[{value:30,label:'30s',key:'s30'},{value:60,label:'1m',key:'m1'},{value:120,label:'2m',key:'m2'},{value:180,label:'3m',key:'m3'},{value:0,label:'Full',key:'presetFull'}];
const clock=s=>`${String(Math.floor(Math.max(0,s)/60)).padStart(2,'0')}:${String(Math.max(0,Math.floor(s))%60).padStart(2,'0')}`;
export function typingKeystroke(target,state,key){
 if(key===BACKSPACE||key===DELETE_WORD){if(state.buffer)state.buffer=key===BACKSPACE?state.buffer.slice(0,-1):'';else if(state.committed.length&&state.committed.at(-1)!==target[state.committed.length-1]){const previous=state.committed.pop();state.buffer=key===BACKSPACE?previous:'';}return null;}
 if(state.committed.length>=target.length||key.length!==1||/[\x00-\x1f\x7f]/.test(key))return null;
 const expected=target[state.committed.length]??'';
 if(key===' '){if(!state.buffer)return null;const correct=state.buffer===expected;state.committed.push(state.buffer);state.buffer='';return correct;}
 if(state.buffer.length>=Math.min(80,expected.length+20))return null;
 const correct=key===expected[state.buffer.length];state.buffer+=key;return correct;
}
export function mountTab(ctx,root){const t=ctx.dict.writingWorkspace.typing,host=el('section',{class:'typing-trainer','data-typing-trainer':'','aria-label':t.title});root.append(host);
 let preset=30,phase='loading',text=null,prepareToken=null,runToken=null,runStarted=null,runPromise=null,pausedAt=null,pausedTotal=0,starting=false,finishing=false,timer=null,requestGeneration=0,pendingFinish=null,pausing=false,lastInteractionAt=0;
 let typed={committed:[],buffer:''},keystrokes=[],samples=[],correctSamples=[],errorSeconds=[],graph=null,summary={count:0,bestWpm:null,bestAccuracy:null},history=[];
 let timeShown=30;
 const tabs=el('div',{class:'typing-presets',role:'radiogroup','aria-label':t.duration});
 const time=el('span',{class:'typing-time',role:'timer','aria-label':t.remaining,'data-typing-timer':''},clock(30));
 const pause=button(t.pause,()=>void togglePause(),{signal:ctx.signal,cls:'typing-pause-orb',attrs:{'data-typing-full-pause':'','aria-label':t.pause}});
 const next=button(t.next,()=>void load({excludeTextId:text?.id}),{signal:ctx.signal,cls:'typing-icon-button typing-next-button',attrs:{'data-typing-next':'','aria-label':t.next,title:t.next}});next.replaceChildren(typingControlIcon('next'));
 const toolbar=el('div',{class:'typing-toolbar'},tabs,el('div',{class:'typing-toolbar-center'},time,pause),next);
 const stage=el('div',{class:'typing-stage-wrap','data-typing-stage':''}),rendered=el('div',{class:'typing-stage typing-font',role:'presentation'}),capture=el('input',{class:'typing-capture','data-typing-input':'','aria-label':t.typeHint,autocomplete:'off',autocorrect:'off',autocapitalize:'off',spellcheck:'false',enterkeyhint:'done'});
 const measure=el('div',{class:'typing-measure typing-font','aria-hidden':'true'}),stack=el('div',{class:'typing-stack'});let ranges=[],wordNodes=[],paintedIndex=0,resizeFrame=null;rendered.setAttribute('aria-hidden','true');rendered.append(stack);
 const footer=el('p',{class:'typing-footer',id:'writing-typing-status'}),live=el('p',{class:'sr-only',role:'status','aria-live':'polite'}),result=el('section',{class:'typing-result','data-typing-result':''});
 stage.append(measure,rendered,capture);host.append(toolbar,stage,footer,result,live);result.hidden=true;
 let presets=[];
 function updateToolbar(){for(const {b,p} of presets){b.setAttribute('aria-checked',String(p.value===preset));b.disabled=['loading','running','saving'].includes(phase);}next.disabled=['loading','running','saving'].includes(phase);pause.hidden=!['ready','running'].includes(phase);pause.disabled=phase!=='running'||pausing;pause.classList.toggle('is-paused',pausedAt!==null);pause.setAttribute('aria-label',pausedAt===null?t.pause:t.resume);pause.title=pausedAt===null?t.pause:t.resume;pause.replaceChildren(typingControlIcon('pause',pausedAt!==null));capture.readOnly=pausedAt!==null;time.hidden=!['ready','running'].includes(phase);time.setAttribute('aria-label',preset===0?t.time:t.remaining);time.textContent=clock(timeShown);}
 for(const p of PRESETS){const b=button(p.label,()=>{if(['running','loading','saving'].includes(phase)||p.value===preset)return;preset=p.value;void load({textId:text?.id});},{signal:ctx.signal,cls:'',attrs:{role:'radio','aria-checked':p.value===preset?'true':'false','data-typing-preset':p.value===0?'full':p.value,'aria-label':t[p.key]}});tabs.append(b);presets.push({b,p});}
 function markInteraction(){lastInteractionAt=performance.now();}
 function timeElapsed(){if(runStarted==null)return 0;const current=pausedAt??performance.now();return Math.max(0,(current-runStarted-pausedTotal)/1000);}
 const charCount=()=>typed.committed.reduce((a,s)=>a+s.length+1,0)+typed.buffer.length;
 function sample(){const current=charCount();samples.push(Math.max(samples.at(-1)??0,current));let correct=0;typed.committed.forEach((s,i)=>{if(s===text.words[i])correct+=s.length+1;});const target=text.words[typed.committed.length]??'';for(let i=0;i<typed.buffer.length&&typed.buffer[i]===target[i];i++)correct++;correctSamples.push(correct);}
 function changePhase(nextPhase){phase=nextPhase;host.setAttribute('data-typing-phase',phase);result.hidden=phase!=='result';stage.hidden=['result','error'].includes(phase);footer.textContent=phase==='loading'?t.loading:phase==='saving'?t.saving:phase==='error'?t.error:phase==='ready'?t.typeHint:'';updateToolbar();}
 async function load(options={}){const gen=++requestGeneration;if(timer){clearInterval(timer);timer=null;}phase='loading';ranges=[];wordNodes=[];runToken=null;runPromise=null;runStarted=null;prepareToken=null;pausedAt=null;pausedTotal=0;starting=false;finishing=false;pausing=false;lastInteractionAt=0;pendingFinish=null;typed={committed:[],buffer:''};keystrokes=[];samples=[];correctSamples=[];errorSeconds=[];graph=null;timeShown=preset;capture.value='';changePhase('loading');stack.replaceChildren();measure.replaceChildren();result.replaceChildren();
  try{const response=await post(ctx,'/api/writing/typing/prepare',{preset,...options});if(ctx.signal.aborted||gen!==requestGeneration)return;if(typeof response.token!=='string'||!Array.isArray(response.text?.words))throw Error();prepareToken=response.token;text=response.text;changePhase('ready');layout();window.requestAnimationFrame?.(()=>{if(!ctx.signal.aborted)capture.focus();});}catch{if(ctx.signal.aborted||gen!==requestGeneration)return;changePhase('error');showError();}}
 function layout(){if(!text||ctx.signal.aborted)return;
  measure.replaceChildren(...text.words.flatMap(word=>[el('span',{},word),' ']));measureLines();
 }
 function measureLines(){if(!text||ctx.signal.aborted)return;const tops=[...measure.children].map(node=>node.offsetTop),next=[];let start=0;
  for(let i=1;i<=tops.length;i++)if(i===tops.length||Math.abs(tops[i]-tops[start])>2){next.push({start,end:i});start=i;}
  if(JSON.stringify(next)===JSON.stringify(ranges)&&wordNodes.length===text.words.length){paint();return;}ranges=next;wordNodes=[];stack.replaceChildren(...ranges.map((line,row)=>{const node=el('div',{class:'typing-row','data-typing-line':row});for(let i=line.start;i<line.end;i++){const word=el('span',{class:'typing-word','data-typing-word':i});wordNodes[i]=word;node.append(word);}return node;}));paintedIndex=-1;paint();
 }
 function paint(){if(!text)return;const current=typed.committed.length;
  const first=paintedIndex<0?0:Math.min(current,paintedIndex),last=paintedIndex<0?wordNodes.length-1:Math.max(current,paintedIndex);
  for(let i=first;i<=last&&i<wordNodes.length;i++){const wanted=text.words[i],given=i<current?typed.committed[i]:i===current?typed.buffer:null,node=wordNodes[i];node.replaceChildren();
   for(let j=0;j<wanted.length;j++){if(i===current&&j===typed.buffer.length)node.append(el('i',{class:'typing-caret'}));node.append(el('span',{class:given===null?'typing-char-future':j<given.length?(given[j]===wanted[j]?'typing-char-correct':'typing-char-wrong'):(i<current?'typing-char-missed':'typing-char-future')},wanted[j]));}
   if(given?.length>wanted.length)for(const char of given.slice(wanted.length))node.append(el('span',{class:'typing-char-extra'},char));if(i===current&&typed.buffer.length>=wanted.length)node.append(el('i',{class:'typing-caret'}));node.append(' ');
  }
  paintedIndex=current;let active=ranges.findIndex(line=>current>=line.start&&current<line.end);if(active<0)active=Math.max(0,ranges.length-1);stack.style.transform='translateY(calc(var(--typing-line-height) * -'+Math.max(0,active-1)+'))';capture.value=typed.buffer;capture.setAttribute('aria-describedby','writing-typing-status');
 }
 function startIfNeeded(){if(phase!=='ready'||starting)return;starting=true;changePhase('running');runStarted=performance.now();markInteraction();runPromise=(async()=>{const generation=requestGeneration;for(let i=0;i<2;i++){try{const res=await post(ctx,'/api/writing/typing/start',{token:prepareToken});if(generation!==requestGeneration||ctx.signal.aborted)return null;if(typeof res.runToken!=='string')return null;runToken=res.runToken;return runToken;}catch{if(generation!==requestGeneration||ctx.signal.aborted)return null;}}return null;})();timer=setInterval(tick,200);}
 function tick(){if(runStarted==null||pausedAt!==null||phase!=='running'||pausing)return;const elapsed=timeElapsed(),seconds=Math.floor(elapsed),cap=preset||Infinity;if(preset>0&&elapsed>=preset){void finish();return;}if(performance.now()-lastInteractionAt>=3000){void togglePause();return;}while(samples.length<Math.min(seconds,cap))sample();timeShown=preset?Math.max(0,Math.ceil(preset-elapsed)):seconds;time.textContent=clock(timeShown);time.classList.toggle('typing-time-warning',preset>0&&timeShown<=10);if(preset>0&&elapsed>=preset)void finish();}
 async function finish(){if(finishing||phase!=='running'||pausedAt!==null)return;finishing=true;if(timer){clearInterval(timer);timer=null;}capture.blur();changePhase('saving');const elapsed=timeElapsed(),seconds=preset&&elapsed>=preset?preset:Math.max(1,elapsed);while(samples.length<Math.floor(seconds))sample();const count=charCount();graph={chars:samples.slice(0,Math.max(1,Math.ceil(seconds))).map(n=>Math.min(n,count)),correct:correctSamples.slice(0,Math.max(1,Math.ceil(seconds))),errors:[...errorSeconds]};const token=runToken??await runPromise;if(!token){changePhase('error');showError();return;}
  pendingFinish={runToken:token,typedWords:[...typed.committed,typed.buffer],samples:graph.chars,keystrokes:[...keystrokes]};await saveFinished();}
 async function saveFinished(){if(!pendingFinish)return;changePhase('saving');try{let payload;try{payload=await post(ctx,'/api/writing/typing/finish',pendingFinish);}catch(e){if(e.code==='too_early'&&preset>0){await new Promise(r=>setTimeout(r,1600));payload=await post(ctx,'/api/writing/typing/finish',pendingFinish);}else throw e;}if(!payload.run)throw Error();if(ctx.signal.aborted)return;pendingFinish=null;summary=payload.summary??summary;history=payload.history??history;showResult(payload.run);changePhase('result');live.textContent=t.summary?.replace('{wpm}',Math.round(payload.run.wpm)).replace('{acc}',Math.round(payload.run.accuracy)).replace('{sec}',Math.round(payload.run.durationMs/1000))??'';}catch{if(!ctx.signal.aborted){changePhase('error');showError();}}}
 function showResult(run){
  const metrics=[['wpm',Math.round(run.wpm)],['accuracy',Math.round(run.accuracy)+'%']];
  const cells=[['duration',run.presetSeconds===null?'Full':`${run.presetSeconds}s`],['rawWpm',Math.round(run.rawWpm)],
   ['characters',`${run.correct}/${run.incorrect}/${run.extra}/${run.missed}`],
   ...(run.consistency==null?[]:[['consistency',Math.round(run.consistency)+'%']]),
   ['time',Math.round(run.durationMs/1000)+'s']];
  const plot=el('div',{class:'typing-graph-cell'},graphSvg(graph,t),el('div',{class:'typing-chart-legend'},el('span',{},t.wpm),el('span',{},t.rawWpm)));
  result.replaceChildren(
   el('div',{class:'typing-result-primary'},metrics.map(([k,v])=>el('div',{},el('span',{},t[k]??k),el('strong',{},String(v))))),
   plot,
   el('div',{class:'typing-result-stats'},cells.map(([k,v])=>el('div',{},el('span',{},t[k]??k),el('strong',{},String(v))))),
   el('div',{class:'typing-result-actions'},...[
    ['repeat',()=>void load({textId:text.id}),'data-typing-repeat'],['next',()=>void load({excludeTextId:text.id}),'data-typing-next-result']
   ].map(([kind,action,key])=>{const b=button('',action,{signal:ctx.signal,cls:'typing-icon-button typing-icon-primary',attrs:{[key]:'','aria-label':t[kind],title:t[kind]}});b.append(typingControlIcon(kind));return b;})),
   el('details',{class:'typing-history'},el('summary',{},`${t.history} · ${summary.count} ${t.runs}`),el('div',{class:'typing-history-scroll'},el('table',{},el('thead',{},el('tr',{},['text','wpm','accuracy','mode','date'].map(key=>el('th',{},t[key])))),el('tbody',{},history.slice(0,10).map(row=>el('tr',{},el('td',{},row.title),el('td',{},String(row.wpm)),el('td',{},String(row.accuracy)+'%'),el('td',{},row.presetSeconds?row.presetSeconds+'s':t.presetFull),el('td',{},new Intl.DateTimeFormat(ctx.locale==='uz'?'uz-UZ':'en-GB',{year:'numeric',month:'short',day:'numeric',timeZone:'Asia/Tashkent'}).format(new Date(row.createdAt))))))))));
 }
 function showError(){result.hidden=false;result.replaceChildren(el('p',{role:'alert'},t.error),pendingFinish?button(ctx.dict.errorPage.retry,()=>void saveFinished(),{signal:ctx.signal}):null,button(t.repeat,()=>void load({textId:text?.id}),{signal:ctx.signal}));}
 async function togglePause(){if(phase!=='running'||pausing||ctx.signal.aborted)return;pausing=true;pause.disabled=true;const wasPaused=pausedAt!==null,requestedAt=performance.now();try{const token=runToken??await runPromise;if(!token||ctx.signal.aborted||phase!=='running')return;const res=await post(ctx,wasPaused?'/api/writing/typing/resume':'/api/writing/typing/pause',{runToken:token});if(ctx.signal.aborted||phase!=='running')return;if(typeof res.runToken!=='string'||res.paused===wasPaused)throw Error('invalid_pause_response');runToken=res.runToken;if(res.paused){pausedAt=requestedAt;capture.blur();}else if(pausedAt!==null){pausedTotal+=performance.now()-pausedAt;pausedAt=null;markInteraction();capture.focus();}}catch{markInteraction();if(!ctx.signal.aborted)footer.textContent=t.error;}finally{pausing=false;if(!ctx.signal.aborted)updateToolbar();}}
 capture.addEventListener('input',()=>{if(!text||!['ready','running'].includes(phase)||pausedAt!==null||pausing)return;markInteraction();const previous=typed.buffer,nextValue=capture.value;let common=0;while(common<previous.length&&common<nextValue.length&&previous[common]===nextValue[common])common++;for(let i=previous.length;i>common;i--){typingKeystroke(text.words,typed,BACKSPACE);keystrokes.push(BACKSPACE);}for(const ch of nextValue.slice(common)){if(typed.committed.length>=text.words.length)break;const scored=typingKeystroke(text.words,typed,ch);if(scored===null)continue;startIfNeeded();keystrokes.push(ch);if(!scored)errorSeconds.push(Math.floor(timeElapsed()));}paint();const count=text.words.length;if(typed.committed.length>=count||typed.committed.length===count-1&&typed.buffer===text.words[count-1])void finish();},{signal:ctx.signal});
 capture.addEventListener('keydown',e=>{if(pausedAt!==null||pausing){e.preventDefault();return;}markInteraction();if((e.key==='Backspace')&&phase==='running'){e.preventDefault();const key=e.ctrlKey||e.metaKey?DELETE_WORD:BACKSPACE;typingKeystroke(text.words,typed,key);keystrokes.push(key);paint();}},{signal:ctx.signal});
 for(const ev of ['paste','drop'])capture.addEventListener(ev,e=>e.preventDefault(),{signal:ctx.signal});capture.addEventListener('beforeinput',e=>{if(e.inputType==='insertFromPaste'||e.inputType==='insertFromDrop')e.preventDefault();},{signal:ctx.signal});
 stage.addEventListener('pointerdown',event=>{event.preventDefault();markInteraction();if(pausedAt===null&&!pausing)capture.focus();},{signal:ctx.signal});
 for(const action of ['pointerdown','keydown','touchstart'])document.addEventListener(action,markInteraction,{signal:ctx.signal,passive:true});
 let observer;if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>{if(resizeFrame!==null)window.cancelAnimationFrame?.(resizeFrame);resizeFrame=window.requestAnimationFrame?.(measureLines);});observer.observe(stage);}void document.fonts?.ready.then(measureLines);
 ctx.signal.addEventListener('abort',()=>{requestGeneration++;if(timer)clearInterval(timer);observer?.disconnect();if(resizeFrame!==null)window.cancelAnimationFrame?.(resizeFrame);},{once:true});
 void load();}

/** SVG plot mirrors the original TypingTrainer ResultView; styles remain CSS3. */
function graphSvg(graph,t){
 const svg=(name,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
 const width=600,height=200,left=38,bottom=24,pad=8,chars=graph?.chars??[],correct=graph?.correct??[],errors=graph?.errors??[];
 const count=chars.length;
 const raw=chars.map((v,i)=>{const n=Math.min(3,i+1);return ((v-(chars[i-n]??0))/n)*12;});
 const wpm=correct.map((v,i)=>v*12/(i+1));
 const ceiling=Math.max(20,Math.ceil(Math.max(0,...raw,...wpm)/20)*20);
 const x=i=>left+(count<=1?0:(i/(count-1))*(width-left-pad));
 const y=v=>height-bottom-(v/ceiling)*(height-bottom-pad);
 const out=svg('svg',{class:'typing-graph',viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':t.graph??'Typing graph'});
 for(const level of [0,ceiling/2,ceiling]){
  const g=svg('g');g.append(svg('line',{x1:left,x2:width-pad,y1:y(level),y2:y(level)}));
  const label=svg('text',{x:left-6,y:y(level)+4,'text-anchor':'end'});label.textContent=String(Math.round(level));g.append(label);out.append(g);
 }
 if(count>1){out.append(svg('polyline',{fill:'none',class:'typing-raw-line',points:raw.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}));
  out.append(svg('polyline',{fill:'none',points:wpm.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}));}
 for(const sec of errors){if(!count)continue;const i=Math.min(count-1,Math.max(0,sec)),px=x(i),py=y(raw[i]??0);
  out.append(svg('path',{class:'typing-error-marker',d:`M${px-4} ${py-4}l8 8m0-8l-8 8`}));}
 return out;
}
