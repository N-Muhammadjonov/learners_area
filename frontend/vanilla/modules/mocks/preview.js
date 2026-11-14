import {el,listen} from '../../js/dom.js';
import {renderObjectiveMaterial,renderObjectiveReview} from './objective-material.js';
import {MOCK_EXAM_CSS} from './exam-surface.js';
import {cdSplit} from '../shared/cd-layout.js';

export function renderMockPreview(data,{signal,locale='uz',onClose}){
  const uz=locale==='uz';let activeAudio=null;const stage=el('div',{'data-mock-stage':''});const tabs=el('nav',{class:'flex flex-wrap gap-2'});
  const answers={listening:{},reading:{},writingTask1:'',writingTask2:''};
  const stopAudio=()=>{activeAudio?.pause();activeAudio=null;};
  signal?.addEventListener('abort',stopAudio,{once:true});
  const close=el('button',{type:'button',class:'btn-secondary'},uz?'Ko‘rishni yopish':'Close preview');
  listen(close,'click',()=>{stopAudio();onClose();},signal);
  const heading=el('header',{class:'mock-exam-header'},
    el('span',{class:'mock-exam-brand'},'LA'),
    el('h2',{class:'font-display text-xl'},`${data.title} · ${uz?'Oldindan ko‘rish':'Preview'}`),
    el('p',{class:'text-sm text-ink-500'},uz?'Bu ko‘rish rejimi. Natijalar saqlanmaydi va mock o‘quvchilarga ochilmaydi.':'Preview only. No attempt is created and learner access stays unchanged.'),close);
  tabs.setAttribute('data-mock-section-tabs','');
  const show=(slot)=>{
    stopAudio();
    const material=data.materials[slot];if(!material){stage.replaceChildren(el('p',{},uz?'Material topilmadi.':'Material unavailable.'));return;}
    if(slot==='reading'||slot==='listening'){
      const audio=slot==='listening'?el('audio',{src:material.audioUrl,controls:'',preload:'metadata',class:'w-full'}):null;
      activeAudio=audio;
      if(audio)queueMicrotask(()=>{if(audio.isConnected)void audio.play().catch(()=>{});});
      const content=renderObjectiveMaterial({material,skill:slot,answers:answers[slot],onAnswer:()=>{},signal,audioWidget:audio});
      const review=el('button',{type:'button',class:'btn-secondary mt-3'},uz?'Javob va izohlarni ko‘rish':'Show answer explanations');
      const reviewHost=el('div',{class:'mock-preview-review',hidden:true});
      listen(review,'click',()=>{reviewHost.hidden=!reviewHost.hidden;reviewHost.replaceChildren(renderObjectiveReview(material.questions.map((q,index)=>({
        questionId:String(q.id),number:q.order||index+1,
        questionText:String(material.groups?.find(g=>g.id===q.groupId)?.stimulusText||q.questionText||'').replace(/\{\{(\d+)\}\}/g,'$1. ______'),
        studentAnswer:answers[slot][String(q.id)]||'',correctAnswer:q.correctAnswer||q.correct_answer||'',
        explanation:q.explanation||'',evidenceQuote:q.evidenceQuote||'',evidence:q.evidence||{}
      })),locale));},signal);
      stage.replaceChildren(content,review,reviewHost);
    }else{
      const task1=slot==='writingTask1';
      const editor=el('textarea',{class:'input','data-mock-writing-editor':slot,'aria-label':'Writing preview answer',spellcheck:'false'});
      editor.value=answers[slot];
      const words=el('span',{'data-mock-word-count':slot});
      const count=()=>{answers[slot]=editor.value;words.textContent='Words: '+(editor.value.trim()?editor.value.trim().split(/\s+/).length:0);};
      count();listen(editor,'input',count,signal);
      const prompt=el('div',{class:'panel','data-mock-writing-prompt':slot},
        el('h3',{},task1?'Writing Task 1':'Writing Task 2'),
        el('p',{},material.prompt||''),material.mediaRef?el('img',{src:material.mediaRef,alt:'Writing Task 1'}):null);
      const taskTabs=el('div',{class:'mock-writing-tabs'});
      for(const [key,label] of [['writingTask1','Task 1'],['writingTask2','Task 2']]){
        if(!data.materials[key])continue;
        const button=el('button',{type:'button',role:'tab','aria-selected':String(key===slot)},label);
        listen(button,'click',()=>show(key),signal);taskTabs.append(button);
      }
      stage.replaceChildren(el('section',{class:'mock-writing','data-cd-exam':'writing'},
        el('div',{class:'mock-writing-instruction'},el('strong',{},task1?'Part 1':'Part 2')),
        cdSplit(prompt,el('div',{class:'panel'},words,editor),signal),taskTabs));
    }
  };
  for(const [slot,title] of [['listening','Listening'],['reading','Reading'],['writingTask1','Writing Task 1'],['writingTask2','Writing Task 2']]){
    if(!data.materials[slot])continue;
    const button=el('button',{type:'button',class:'btn-secondary btn-sm','data-mock-preview-slot':slot},title);
    listen(button,'click',()=>show(slot),signal);tabs.append(button);
  }
  show(data.materials.listening?'listening':'reading');
  return el('section',{'data-mock-runner':'preview-'+data.testId,'data-mock-staff-preview':data.testId},el('style',{},MOCK_EXAM_CSS),heading,tabs,stage);
}
