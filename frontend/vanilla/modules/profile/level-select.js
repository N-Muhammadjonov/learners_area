/** Learner profile CEFR selector, independent of existing study preferences. */
import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';

const API='/api/study-plan/monthly/sequence/level';
const LEVELS=['A1','A2','B1','B2','C1','C2'];

export function profileLevel(ctx) {
  if(!['student','owner'].includes(ctx.session?.user?.role))return null;
  const uz=ctx.locale==='uz',label=(a,b)=>uz?a:b;
  const section=h('section',{class:'panel space-y-4','data-profile-level':''});
  const heading=h('h2',{class:'text-xl font-semibold'},
    label('Ingliz tili darajasi','English proficiency level'));
  const description=h('p',{class:'text-sm text-ink-500'},
    label('7 yoki 30 kunlik reja uchun darajangizni belgilang. Bu shaxsiy baholash, rasmiy sertifikat emas.',
      'Set your level for a 7- or 30-day plan. This is a self-assessment, not a certificate.'));
  const select=h('select',{class:'input',id:'profile-cefr-select',
    'data-profile-level-select':'','aria-label':label('Daraja','Level')},
    h('option',{value:''},label('Darajani tanlang','Select a level')),
    LEVELS.map(level=>h('option',{value:level},level)));
  const save=h('button',{type:'submit',class:'btn-primary',
    'data-profile-level-save':''},label('Darajani saqlash','Save level'));
  const status=h('p',{role:'status',class:'text-sm'});
  const form=h('form',{class:'flex flex-col gap-3',onSubmit:event=>{
    event.preventDefault();
    void submit();
  }},h('label',{htmlFor:'profile-cefr-select'},label('Joriy darajam','My current level')),
    select,h('div',{class:'flex flex-wrap gap-2'},save,
      h('a',{href:'/app/plan/level-check',class:'btn-secondary'},
        label('Darajani test orqali aniqlash','Take a level check'))),status);
  section.append(heading,description,form);
  if(ctx.url?.searchParams.get('edit')==='level'){
    queueMicrotask(()=>{if(!ctx.signal.aborted&&select.isConnected)select.focus();});
  }
  let busy=false;
  function sync(){
    save.disabled=busy||!LEVELS.includes(select.value);
    select.disabled=busy;
  }
  async function initial(){
    sync();
    try{
      const data=await api.request(API,{signal:ctx.signal,fresh:true});
      if(ctx.signal.aborted)return;
      if(LEVELS.includes(data.currentLevel))select.value=data.currentLevel;
      sync();
    }catch{
      if(!ctx.signal.aborted)status.textContent=label(
        'Darajani yuklab bo‘lmadi, ammo qo‘lda tanlashingiz mumkin.',
        'Could not load your level, but you can still select one.');
    }
  }
  async function submit(){
    if(ctx.signal.aborted||busy||!LEVELS.includes(select.value))return;
    busy=true;status.textContent='';sync();
    try{
      const data=await api.request(API+'/manual',{
        method:'POST',body:{level:select.value},signal:ctx.signal});
      if(ctx.signal.aborted)return;
      if(data?.state!=='saved'||data.level!==select.value)throw Error('invalid_level_save');
      status.textContent=label(
        'Daraja saqlandi. Endi Assignments ichida 7 yoki 30 kunlik rejani tanlashingiz mumkin.',
        'Level saved. You can now choose a 7- or 30-day plan in Assignments.');
    }catch{
      if(!ctx.signal.aborted)status.textContent=label(
        'Saqlashda xatolik. Qayta urinib ko‘ring.','Could not save the level. Please retry.');
    }finally{busy=false;sync();}
  }
  select.addEventListener('change',sync,{signal:ctx.signal});
  void initial();
  return section;
}
