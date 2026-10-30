import {el} from '../../js/dom.js';
import packs from './study-pack-data.js';

const letters=['A','B','C','D','E','F','G','H','I'];
const normalise=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const findTedStudyPack=title=>packs.find(pack=>normalise(pack.title)===normalise(title));
export function readStudyAnswers(initial){
 try{const value=JSON.parse(initial);if(value.kind==='ted-study-pack-v1'&&value.answers&&typeof value.answers==='object')return Object.fromEntries(Object.entries(value.answers).filter(([key,text])=>letters.includes(key)&&typeof text==='string'&&text.length<=1000));}catch{}
 return {};
}

/** Native A–I exercises, matching the Main study pack's controls and response
 * envelope. The answer guide is instructional content, never an auto grade. */
export function createTedStudyPractice({pack,initial,dict,signal,save}){
 const labels=dict.videoLesson.studyPack;
 const node=el('section',{class:'card space-y-4 p-5','data-ted-study-pack':''});
 let active='B',answers=readStudyAnswers(initial),busy=false,recorder=null,loadingRecorder=false;
 const nav=el('nav',{class:'flex flex-wrap gap-2','aria-label':labels.title});
 const taskHost=el('div',{'data-ted-task':''}),recordHost=el('div',{}),guide=el('div',{}),status=el('p',{role:'status'});
 const saveButton=el('button',{type:'button',class:'btn-primary'},dict.videoLesson.save);
 const keyButton=el('button',{type:'button',class:'btn-secondary','aria-expanded':'false'},labels.key);
 const buttons=new Map();
 node.append(el('h2',{class:'font-display text-xl'},labels.title),el('p',{class:'text-sm text-ink-500'},labels.source));
 if(pack.sourceUrl)node.append(el('a',{class:'btn-secondary inline-flex',href:pack.sourceUrl,target:'_blank',rel:'noreferrer'},labels.official));
 node.append(nav,el('details',{class:'rounded-xl border border-ink-100 p-4'},el('summary',{},labels.glossary),el('p',{class:'mt-3 whitespace-pre-line leading-6'},pack.glossary)),taskHost,recordHost,el('div',{class:'flex flex-wrap gap-2'},saveButton,keyButton),guide,status);
 for(const key of letters){
  const button=el('button',{type:'button','data-ted-stage':key},pack.tasks[key].name);
  button.addEventListener('click',()=>{active=key;status.textContent='';render();},{signal});buttons.set(key,button);nav.append(button);
 }
 function fieldsFor(text){try{const value=JSON.parse(text??'{}');if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==='string'));}catch{}return {};}
 async function syncRecorder(){
  const enabled=pack.tasks[active].kind==='summary';recordHost.hidden=!enabled;recorder?.setActive(enabled);
  if(!enabled||recorder||loadingRecorder)return;
  loadingRecorder=true;
  try{const {createReflectionRecorder}=await import('./reflection-recorder.js');if(signal.aborted)return;recorder=createReflectionRecorder({dict,signal});recordHost.append(recorder.node);recorder.setActive(pack.tasks[active].kind==='summary');}
  catch{if(!signal.aborted)recordHost.append(el('p',{role:'alert'},dict.videoLesson.voiceSummary.failed));}
  finally{loadingRecorder=false;}
 }
 function render(){
  const task=pack.tasks[active],rows=task.prompt.split('\n'),numbered=rows.filter(row=>/^\d+\./.test(row)),definitions=rows.filter(row=>/^[A-Z]\./.test(row));
  for(const [key,button] of buttons){button.className=key===active?'btn-primary':'btn-secondary';button.setAttribute('aria-pressed',String(key===active));}
  taskHost.dataset.tedTask=active;taskHost.replaceChildren();guide.replaceChildren();keyButton.hidden=!task.key;keyButton.setAttribute('aria-expanded','false');
  if(['D','E'].includes(active)&&numbered.length){
   const fields=fieldsFor(answers[active]);taskHost.className='space-y-3';
   if(active==='E')taskHost.append(el('p',{},rows[0]));
   numbered.forEach((row,i)=>{
    const input=active==='D'?el('select',{class:'input mt-2'},el('option',{value:''},dict.fullListeningHub.activity.choose),definitions.map(def=>el('option',{value:def[0]},def))):el('input',{class:'input mt-2',maxlength:'100'});
    input.value=fields[i]??'';const stage=active;
    input.addEventListener(active==='D'?'change':'input',()=>{fields[i]=input.value;answers[stage]=JSON.stringify(fields);},{signal});
    taskHost.append(el('label',{class:'block rounded-xl border border-ink-100 p-4'},el('span',{},row),input));
   });
  }else{
   taskHost.className='space-y-3';const stage=active,input=el('textarea',{class:'input mt-2 min-h-40',maxlength:'1000'});input.value=answers[active]??'';
   input.addEventListener('input',()=>{answers[stage]=input.value;},{signal});
   taskHost.append(el('p',{class:'whitespace-pre-line leading-7'},task.prompt),el('label',{class:'block'},labels.response,input));
  }
  void syncRecorder();
 }
 keyButton.addEventListener('click',()=>{
  const revealed=keyButton.getAttribute('aria-expanded')!=='true';keyButton.setAttribute('aria-expanded',String(revealed));guide.replaceChildren();
  if(revealed)guide.append(el('div',{class:'rounded-xl border border-ink-100 p-4'},el('p',{class:'text-sm text-ink-500'},labels.model),el('p',{class:'whitespace-pre-line'},pack.tasks[active].key)));
 },{signal});
 saveButton.addEventListener('click',async()=>{
  if(busy||signal.aborted)return;
  const text=JSON.stringify({kind:'ted-study-pack-v1',answers});
  if(text.length>4000){status.textContent=labels.tooLong;return;}
  busy=true;saveButton.disabled=true;saveButton.textContent=dict.videoLesson.saving;status.textContent='';
  try{const ok=await save(text);if(!signal.aborted)status.textContent=ok?dict.videoLesson.saved:dict.common.error;}
  catch{if(!signal.aborted)status.textContent=dict.common.error;}
  finally{busy=false;if(!signal.aborted){saveButton.disabled=false;saveButton.textContent=dict.videoLesson.save;}}
 },{signal});
 signal.addEventListener('abort',()=>recorder?.destroy(),{once:true});
 render();return node;
}
