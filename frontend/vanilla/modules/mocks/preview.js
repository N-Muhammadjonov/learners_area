import {el,listen} from '../../js/dom.js';
import {renderObjectiveMaterial,renderObjectiveReview} from './objective-material.js';

export function renderMockPreview(data,{signal,locale='uz',onClose}){
  const uz=locale==='uz';const stage=el('div',{});const tabs=el('nav',{class:'flex flex-wrap gap-2'});
  const answers={listening:{},reading:{}};
  const close=el('button',{type:'button',class:'btn-secondary'},uz?'Ko‘rishni yopish':'Close preview');
  listen(close,'click',onClose,signal);
  const heading=el('div',{class:'panel flex flex-col gap-2'},
    el('h2',{class:'font-display text-xl'},`${data.title} · ${uz?'Oldindan ko‘rish':'Preview'}`),
    el('p',{class:'text-sm text-ink-500'},uz?'Bu ko‘rish rejimi. Natijalar saqlanmaydi va mock o‘quvchilarga ochilmaydi.':'Preview only. No attempt is created and learner access stays unchanged.'),tabs,close);
  const show=(slot)=>{
    const material=data.materials[slot];if(!material){stage.replaceChildren(el('p',{},uz?'Material topilmadi.':'Material unavailable.'));return;}
    if(slot==='reading'||slot==='listening'){
      const audio=slot==='listening'?el('audio',{src:material.audioUrl,controls:'',preload:'metadata',class:'w-full'}):null;
      const content=renderObjectiveMaterial({material,skill:slot,answers:answers[slot],onAnswer:()=>{},signal,audioWidget:audio});
      const review=el('button',{type:'button',class:'btn-secondary mt-3'},uz?'Javob va izohlarni ko‘rish':'Show answer explanations');
      const reviewHost=el('div',{});
      listen(review,'click',()=>reviewHost.replaceChildren(renderObjectiveReview(material.questions.map((q,index)=>({
        questionId:String(q.id),number:q.order||index+1,
        questionText:String(material.groups?.find(g=>g.id===q.groupId)?.stimulusText||q.questionText||'').replace(/\{\{(\d+)\}\}/g,'$1. ______'),
        studentAnswer:answers[slot][String(q.id)]||'',correctAnswer:q.correctAnswer||q.correct_answer||'',
        explanation:q.explanation||'',evidenceQuote:q.evidenceQuote||'',evidence:q.evidence||{}
      })),locale)),signal);
      stage.replaceChildren(content,review,reviewHost);
    }else{
      stage.replaceChildren(el('section',{class:'panel grid grid-cols-1 gap-5 lg:grid-cols-2'},
        el('div',{},el('p',{class:'whitespace-pre-wrap'},material.prompt||''),material.mediaRef?el('img',{src:material.mediaRef,alt:'Writing Task 1',class:'max-w-full h-auto'}):null),
        el('textarea',{class:'input min-h-[400px]',placeholder:uz?'Javob yozish maydoni':'Answer area','aria-label':'Writing preview answer'})));
    }
  };
  for(const [slot,title] of [['listening','Listening'],['reading','Reading'],['writingTask1','Writing Task 1'],['writingTask2','Writing Task 2']]){
    if(!data.materials[slot])continue;
    const button=el('button',{type:'button',class:'btn-secondary btn-sm','data-mock-preview-slot':slot},title);
    listen(button,'click',()=>show(slot),signal);tabs.append(button);
  }
  show(data.materials.listening?'listening':'reading');
  return el('section',{class:'flex flex-col gap-4','data-mock-staff-preview':data.testId},heading,stage);
}
