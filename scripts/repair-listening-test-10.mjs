import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function repairListeningTest10(){
 const root='services/backend/assets/listening/';
 const sourcePath='content/listening/academic/test-10/source.html';
 const runtimePath=root+'test-10.json';
 const manifestPath=root+'manifest.json';
 const userPath='content/listening/academic/test-10/submitted-transcripts.json';
 const source=readFileSync(sourcePath,'utf8');
 const runtime=JSON.parse(readFileSync(runtimePath,'utf8'));
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 const supplied=JSON.parse(readFileSync(userPath,'utf8'));
 const other=JSON.parse(readFileSync(root+'test-11.json','utf8')).files['source.html'];
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(hash(source)!==manifest.entries['test-10'].sourceSha256)throw Error('Test 10 source checksum drift');
 const extract=(text,start,finish)=>{
  const a=text.indexOf(start),b=text.indexOf(finish,a+start.length);
  if(a<0||b<0)throw Error('Missing function boundary: '+start);
  return text.slice(a,b);
 };
 function spanJson(text){
  const begin=text.indexOf('const DATA=')+'const DATA='.length;
  if(begin<11)throw Error('DATA missing');
  let depth=0,quoted=false,escaped=false;
  for(let i=begin;i<text.length;i++){
   const c=text[i];
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"'){quoted=true;continue;}
   if(c==='{'||c==='[')depth++;
   if((c==='}'||c===']')&&--depth===0)return {begin,end:i+1,data:JSON.parse(text.slice(begin,i+1))};
  }
  throw Error('DATA object not closed');
 }
 let html=source;
 const {begin,end,data}=spanJson(html);
 data.transcript={1:supplied.parts['1'],2:supplied.parts['2'],3:'',4:supplied.parts['4']};
 data.transcript_source='Cleaned user-supplied Parts 1, 2 and 4. Part 3 was not copied because the supplied Maya/Liam conversation contradicts the original Sarah/Mike/Professor North questions. Audio transcript alignment not independently verified.';
 data.audio_available=true;
 data.audio_status='Cloudflare R2 original recording exists: listening/academic/test-10/full.mp3; transcript versus audio alignment is not verified.';
 data.script_completion=[];
 const picks={1:['noisy neighbours','south-east','washing machine','One year','15th of May','employer','bank statement','bus stop'],
              2:['glass bottom boat','water is so clear','Churchill Peters','rainfall','east wind','Feeding the fish','professional underwater photographers','own boat'],
              4:['confidence','unscripted improvisation','taking risks','listening to one another','responsible','role reversal','taboo subjects','reenact scenes']};
 for(const [n,phrases]of Object.entries(picks)){
  let cursor=0;const body=data.transcript[n],lower=body.toLowerCase();
  for(let i=0;i<phrases.length;i++){
   const at=lower.indexOf(phrases[i].toLowerCase(),cursor);
   if(at<0)throw Error('Missing gap in Part '+n+': '+phrases[i]);
   const match=body.slice(at,at+phrases[i].length);
   data.script_completion.push({q:Number(n)*100+i+1,part:Number(n),n:i+1,match,answer:match,lexical_type:'contextual expression'});
   cursor=at+match.length;
  }
 }
 html=html.slice(0,begin)+JSON.stringify(data)+html.slice(end);
 html=html.replace(extract(html,'function renderTrainer(','/* Review */'),extract(other,'function renderTrainer(','/* Review */'));
 html=html.replace(extract(html,'function playWindow(','/* Script Completion */'),extract(other,'function playWindow(','/* Script Completion */'));
 function buildScriptTranscript(part){
  const source=DATA.transcript[String(part)]||'',gaps=DATA.script_completion.filter(g=>g.part===part);
  let cursor=0,out='';
  for(const g of gaps){
   const at=source.indexOf(g.match,cursor);
   if(at<0)continue;
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
  const range=DATA.part_audio_boundaries[String(scriptPart)];
  renderTrainer($('#scriptAudio'),range.start,range.end);
  const gaps=DATA.script_completion.filter(g=>g.part===scriptPart);
  const transcript=DATA.transcript[String(scriptPart)]||'';
  if(!transcript){
   $('#scriptHost').innerHTML='<div class="panel"><h2>Part '+scriptPart+' · '+escapeHtml(DATA.sections[scriptPart-1])+'</h2><p role="status">The supplied Part 3 dialogue conflicts with the original test questions. The correct transcript has not been verified, so unrelated text will not be shown as evidence.</p></div>';
   return;
  }
  $('#scriptHost').innerHTML='<div class="panel"><h2>Part '+scriptPart+' · '+escapeHtml(DATA.sections[scriptPart-1])+'</h2><p class="script-part-note">Complete the '+gaps.length+' contextual gaps while listening to this Part.</p><div class="transcript script-transcript">'+buildScriptTranscript(scriptPart)+'</div><div class="script-actions"><button class="btn primary" id="checkScriptPart">Check this Part</button><button class="btn" id="retryGaps" disabled>Retry incorrect gaps</button><span class="script-score" id="scriptScore"></span></div></div>';
  $('#checkScriptPart').onclick=()=>{
   let correct=0;const wrong=[];
   for(const gap of gaps){
    const input=$('[data-gap="'+gap.q+'"]'),result=$('[data-gapresult="'+gap.q+'"]');
    if(!input||!result)continue;
    const ok=normalize(input.value)===normalize(gap.answer);
    input.dataset.ok=ok?'1':'0';input.classList.toggle('gap-ok',ok);input.classList.toggle('gap-bad',!ok);
    result.textContent=ok?'':'Correct: '+gap.answer;result.classList.toggle('show',!ok);
    if(ok)correct++;else wrong.push(gap.q);
   }
   $('#scriptScore').textContent=correct+'/'+gaps.length+' correct';
   $('#retryGaps').disabled=wrong.length===0;$('#retryGaps').dataset.wrong=wrong.join(',');
  };
  $('#retryGaps').onclick=()=>{
   const list=($('#retryGaps').dataset.wrong||'').split(',').filter(Boolean);
   for(const id of list){
    const input=$('[data-gap="'+id+'"]'),result=$('[data-gapresult="'+id+'"]');
    if(!input||!result)continue;
    input.value='';input.dataset.ok='';input.classList.remove('gap-bad');result.textContent='';result.classList.remove('show');
   }
   $('#scriptScore').textContent='';$('#retryGaps').disabled=true;
  };
 }
 html=html.replace(extract(html,'function buildScriptTranscript(','/* MCQ Mastery */'),buildScriptTranscript.toString()+'\n'+renderScript.toString()+'\n');
 html=html.replaceAll('Audio is embedded in this file and plays once in Exam Mode. Review and practice audio controls use the same embedded recording.','Audio is delivered securely by Learners Area from Cloudflare R2.');
 runtime.files[runtime.entryPath]=html;
 const serialized=JSON.stringify(runtime);
 manifest.entries['test-10']={...manifest.entries['test-10'],sourceSha256:hash(html),runtimeSha256:hash(serialized),bytes:Buffer.byteLength(serialized)};
 writeFileSync(sourcePath,html);
 writeFileSync(runtimePath,serialized);
 writeFileSync(manifestPath,JSON.stringify(manifest)+'\n');
}

repairListeningTest10();
