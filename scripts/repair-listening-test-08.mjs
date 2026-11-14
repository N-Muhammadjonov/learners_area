import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function buildScriptTranscript(part){
 const source=DATA.transcript[String(part)]||'',gaps=DATA.script_completion.filter(g=>g.part===part);
 let cursor=0,out='';
 for(const g of gaps){
  const at=source.indexOf(g.match,cursor);
  if(at<0)throw Error('Missing Part '+part+' gap '+g.n);
  out+='<span data-script-source-start="'+cursor+'">'+escapeHtml(source.slice(cursor,at))+'</span>';
  out+='<span class="script-gap-wrap"><b class="script-gap-number">'+g.n+'</b><input class="script-gap-input" data-gap="'+g.q+'" autocomplete="off" aria-label="Part '+part+' gap '+g.n+'"><span class="script-gap-answer" data-gapresult="'+g.q+'"></span></span>';
  cursor=at+g.match.length;
 }
 return out+'<span data-script-source-start="'+cursor+'">'+escapeHtml(source.slice(cursor))+'</span>';
}
function renderScript(){
 stopAllAudio();
 const tabs=$('#scriptTabs');
 tabs.innerHTML=[1,2,3,4].map(p=>'<button class="btn '+(p===scriptPart?'active':'')+'" data-spart="'+p+'">Part '+p+'</button>').join('');
 $$('[data-spart]').forEach(b=>b.onclick=()=>{scriptPart=Number(b.dataset.spart);renderScript()});
 setAudioPart(scriptPart,true);
 renderTrainer($('#scriptAudio'),0,9999);
 const gaps=DATA.script_completion.filter(g=>g.part===scriptPart);
 $('#scriptHost').innerHTML='<div class="panel"><h2>Part '+scriptPart+' · '+escapeHtml(DATA.sections[scriptPart-1])+'</h2><p>Complete the '+gaps.length+' listening transcript gaps, then check your work.</p><div class="transcript script-transcript">'+buildScriptTranscript(scriptPart)+'</div><div class="script-actions"><button class="btn primary" id="checkScriptPart">Check Part</button><button class="btn" id="retryGaps" disabled>Retry incorrect gaps</button><span id="scriptScore" aria-live="polite"></span></div></div>';
 $('#checkScriptPart').onclick=()=>{
  let correct=0;const wrong=[];
  for(const gap of gaps){
   const input=$('[data-gap="'+gap.q+'"]'),result=$('[data-gapresult="'+gap.q+'"]');
   if(!input||!result)continue;
   const ok=normalize(input.value)===normalize(gap.answer);
   input.dataset.ok=ok?'1':'0';input.classList.toggle('gap-ok',ok);input.classList.toggle('gap-bad',!ok);
   result.textContent=ok?'':'Correct: '+gap.answer;
   if(ok)correct++;else wrong.push(gap.q);
  }
  $('#scriptScore').textContent=correct+'/'+gaps.length+' correct';
  $('#retryGaps').disabled=wrong.length===0;$('#retryGaps').dataset.wrong=wrong.join(',');
 };
 $('#retryGaps').onclick=()=>{
  const list=($('#retryGaps').dataset.wrong||'').split(',').filter(Boolean);
  for(const id of list){const input=$('[data-gap="'+id+'"]'),result=$('[data-gapresult="'+id+'"]');if(!input||!result)continue;input.value='';input.dataset.ok='';input.classList.remove('gap-bad');result.textContent='';}
  $('#scriptScore').textContent='';$('#retryGaps').disabled=true;
 };
}
function repair(){
 const srcPath='content/listening/academic/test-08/source.html',runPath='services/backend/assets/listening/test-08.json',manifestPath='services/backend/assets/listening/manifest.json';
 const original=readFileSync(srcPath,'utf8'),runtime=JSON.parse(readFileSync(runPath,'utf8')),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 const hash=s=>createHash('sha256').update(s).digest('hex');
 if(hash(original)!==manifest.entries['test-08'].sourceSha256)throw Error('Original Test 8 source checksum mismatch');
 let text=original,start=text.indexOf('const DATA=')+'const DATA='.length,depth=0,quote=false,escape=false,end=0;
 for(let i=start;i<text.length;i++){
  const c=text[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quote=false;continue;}
  if(c==='"'){quote=true;continue;}if(c==='{'||c==='[')depth++;if((c==='}'||c===']')&&--depth===0){end=i+1;break;}
 }
 if(!end)throw Error('Missing original DATA');
 const data=JSON.parse(text.slice(start,end)),parts={};
 for(let n=1;n<=4;n++){
  const item=JSON.parse(readFileSync('content/listening/academic/test-08/audio-transcript-part-'+n+'.json','utf8'));
  if(item.part!==n||item.transcript.length<2500)throw Error('Invalid Part '+n);
  parts[n]=item.transcript;
 }
 data.transcript=parts;
 data.transcript_status='Speech-recognition transcription recovered from the actual four Cloudflare R2 audio files; word-level errors may remain pending editorial verification.';
 const picks={1:['Adventure Camp','maximum','£180','horse','canoe','caves','helmet','butter'],
  2:['food festival','vegetables','early morning shifts','kitchen','phone numbers','railway station','Marco','vegetarian restaurant'],
  3:['public relations','global communications','New Zealand','economic principles','Chinese','tourism','critical thinking skills','interpersonal skills'],
  4:['spices from Asia','ancient Greeks and Romans','perfumes','medicinally','nutmeg','toothache','peppercorn rent','transport costs','shipbuilding','taxes on trade']};
 data.script_completion=[];
 for(let part=1;part<=4;part++){
  const source=parts[part],lower=source.toLowerCase();let cursor=0;
  for(const [i,phrase]of picks[part].entries()){
   const at=lower.indexOf(phrase.toLowerCase(),cursor);if(at<0)throw Error('Unlocated '+phrase);
   const match=source.slice(at,at+phrase.length);
   data.script_completion.push({q:part*100+i+1,part,n:i+1,match,answer:match,lexical_type:'contextual expression'});
   cursor=at+match.length;
  }
 }
 text=text.slice(0,start)+JSON.stringify(data)+text.slice(end);
 const mustReplace=(from,to)=>{
  if(!text.includes(from))throw Error('Missing source replacement '+from.slice(0,60));
  text=text.replace(from,to);
 };
 mustReplace("['review','02','Review & Revision','Check each Part before answers, evidence and traps are revealed.'],","['review','02','Review & Revision','Check each Part before answers, evidence and traps are revealed.'],\n['script','02a','Script Completion','Listen to the original audio and complete the contextual transcript gaps.'],");
 mustReplace("activityShell('mcq','MCQ Mastery',",`activityShell('script','Script Completion',\`<main class="learn-wrap"><h1>Script Completion</h1><div class="tabs" id="scriptTabs"></div><div class="panel" id="scriptAudio"></div><div id="scriptHost"></div></main>\`)+\nactivityShell('mcq','MCQ Mastery',`);
 mustReplace("if(id==='review')renderReview();if(id==='mcq')", "if(id==='review')renderReview();if(id==='script')renderScript();if(id==='mcq')");
 const insertion='let scriptPart=1;\n'+buildScriptTranscript.toString()+'\n'+renderScript.toString()+'\n';
 mustReplace('/* MCQ Mastery */',insertion+'/* MCQ Mastery */');
 mustReplace('</style>',`.script-transcript{white-space:pre-wrap;line-height:1.85;font-size:15px}.script-gap-wrap{display:inline-flex;align-items:center;gap:4px;margin:0 3px}.script-gap-input{width:130px;max-width:30vw;color:var(--ink);background:#fff;border:1px solid var(--examBlue);padding:5px;border-radius:6px}.script-gap-input.gap-ok{border-color:#16844d}.script-gap-input.gap-bad{border-color:#c23d3d}.script-gap-answer{font-size:12px;color:#4ade80}.script-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:18px;align-items:center}\n</style>`);
 if(text.includes("Script Completion is unavailable for this Part until"))throw Error('Placeholder transcript remains in runtime');
 runtime.files[runtime.entryPath]=text;
 const serialized=JSON.stringify(runtime);
 manifest.entries['test-08']={...manifest.entries['test-08'],sourceSha256:hash(text),runtimeSha256:hash(serialized),bytes:Buffer.byteLength(serialized)};
 writeFileSync(srcPath,text);writeFileSync(runPath,serialized);writeFileSync(manifestPath,JSON.stringify(manifest)+'\n');
}
repair();
// Run only on the isolated repair branch; keep canonical Test 8 source checksum pinned.
