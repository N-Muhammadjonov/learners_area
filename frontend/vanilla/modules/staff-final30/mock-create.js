/** Mock authoring UI. Published source versions only; no fabricated material. */
import {el, listen, mountStaff, heading} from './kit.js';
import {api} from '../../js/api-client.js';

const FIELDS = [
  ['listening','Listening (40 questions)','Listening (40 savol)','listening',null],
  ['reading','Reading (40 questions)','Reading (40 savol)','reading',null],
  ['writingTask1','Writing Task 1','Writing Task 1','writing','task1'],
  ['writingTask2','Writing Task 2','Writing Task 2','writing','task2'],
  ['speaking','Speaking Parts 1–3','Speaking Part 1–3','speaking',null],
];
const LANG = {
  uz:{title:'Mock yaratish',sub:'Haqiqiy materiallarni bog‘lang. Nashr qilishdan oldin har bir bo‘lim tekshiriladi.',
    testName:'Imtihon nomi',track:'Yo‘nalish',academic:'Academic',general:'General Training',
    blank:'Material tanlanmagan',noVersions:'Bu bo‘lim uchun nashr qilingan material topilmadi.',
    save:'Draft saqlash',publish:'Tekshirish va nashr qilish',drafts:'Mock testlar',
    noMocks:'Hozircha Mock test yaratilmagan.',edit:'Tahrirlash',newMock:'Yangi Mock',
    draft:'Qoralama',published:'Nashr qilingan',saved:'Draft saqlandi.',publishedNotice:'Mock nashr qilindi.',
    error:'Saqlash amalga oshmadi.',note:'Nashr qilish uchun Listening, Reading, Writing Task 1/2 va Speaking rasmiy materiallari talab etiladi.',
    disabled:'Nashr qilingan Mock tahrirlanmaydi.'},
  en:{title:'Create Mock',sub:'Bind real published material. Every section is validated before publication.',
    testName:'Exam title',track:'Track',academic:'Academic',general:'General Training',
    blank:'No material selected',noVersions:'No published content available for this section.',
    save:'Save draft',publish:'Validate & publish',drafts:'Mock tests',
    noMocks:'No mocks have been created yet.',edit:'Edit',newMock:'New Mock',
    draft:'Draft',published:'Published',saved:'Draft saved.',publishedNotice:'Mock published.',
    error:'Unable to save.',note:'Publishing requires official Listening, Reading, Writing Task 1/2 and Speaking materials.',
    disabled:'Published mocks are immutable.'},
};

export const mockCreateMount=mountStaff({
  name:'mock-create',roles:['teacher','owner'],
  load:ctx=>api.request('/api/staff/mocks/authoring',{signal:ctx.signal,fresh:true}),
  render(ctx,data,view){
    const L=LANG[ctx.locale==='uz'?'uz':'en'];
    const {signal}=ctx;
    const state=ctx.state.mockComposer??={id:null,title:'',track:'academic',sections:{},busy:false,message:'',error:false};
    const setMessage=(message,error=false)=>{state.message=message;state.error=error;view.rerender();};
    const newButton=el('button',{type:'button',class:'btn-secondary','data-mock-author-new':''},L.newMock);
    listen(newButton,'click',()=>{Object.assign(state,{id:null,title:'',track:'academic',sections:{},message:'',error:false});view.rerender();},signal);
    const titleInput=el('input',{class:'input w-full',required:'',maxlength:'160',value:state.title,
      'aria-label':L.testName,'data-mock-author-title':''});
    listen(titleInput,'input',()=>{state.title=titleInput.value;},signal);
    const trackSelect=el('select',{class:'input w-full','aria-label':L.track,'data-mock-author-track':''},
      el('option',{value:'academic'},L.academic),el('option',{value:'general'},L.general));
    trackSelect.value=state.track;
    listen(trackSelect,'change',()=>{state.track=trackSelect.value;state.sections={};view.rerender();},signal);
    const fields=FIELDS.map(([key,en,uz,module,subtype])=>{
      const label=ctx.locale==='uz'?uz:en;
      const versions=(data.versions||[]).filter(v=>v.module===module &&
        (!subtype||v.contentType===subtype) && (!v.track||v.track==='unspecified'||v.track===state.track));
      const select=el('select',{class:'input w-full','aria-label':label,'data-mock-author-section':key},
        el('option',{value:''},L.blank),
        ...versions.map(v=>el('option',{value:v.id},`${v.title||v.contentType} · v${v.version||1} (${v.track||'—'})`)));
      select.value=state.sections[key]||'';
      listen(select,'change',()=>{state.sections[key]=select.value;},signal);
      return el('label',{class:'flex flex-col gap-2 text-sm text-ink-700'},
        el('span',{class:'font-medium'},label),select,
        versions.length?null:el('span',{class:'text-xs text-band-warn'},L.noVersions));
    });
    const button=(label,publish,attr)=>{
      const b=el('button',{type:'button',class:publish?'btn-primary':'btn-secondary',
        disabled:state.busy,[attr]:''},label);
      listen(b,'click',async()=>{
        if(state.busy||signal.aborted)return;
        if(state.title.trim().length<3){setMessage(L.testName,true);return;}
        state.busy=true;b.disabled=true;
        try{
          const result=await api.request('/api/staff/mocks/authoring',{
            method:'POST',signal,body:{id:state.id,title:state.title.trim(),track:state.track,
              sections:state.sections,publish},
          });
          if(signal.aborted)return;
          state.id=publish?null:result.testId;
          if(publish){state.title='';state.sections={};}
          state.message=publish?L.publishedNotice:L.saved;
          state.error=false;state.busy=false;
          await view.reload();
        }catch(err){if(signal.aborted)return;state.message=`${L.error} (${err.code||'request_failed'})`;state.error=true;view.rerender();}
        finally{state.busy=false;}
      },signal);
      return b;
    };
    const existing=(data.tests||[]);
    const testList=existing.map(test=>el('div',{class:'panel flex flex-wrap items-center justify-between gap-3',
      'data-mock-author-test':test.id},
      el('div',{class:'flex flex-col gap-1'},
        el('strong',{class:'text-sm text-ink-900'},test.title),
        el('span',{class:'text-xs text-ink-500'},`${test.track} · ${test.status==='published'?L.published:L.draft}`)),
      test.status==='draft'?(()=>{const b=el('button',{type:'button',class:'btn-secondary btn-sm',
        'data-mock-author-edit':test.id},L.edit);
        listen(b,'click',()=>{Object.assign(state,{id:test.id,title:test.title,track:test.track,
          sections:{...test.sections},message:'',error:false});view.rerender();},signal);return b;})():null));
    const form=el('section',{class:'panel flex flex-col gap-4','data-mock-authoring-form':''},
      el('p',{class:'text-sm text-ink-500'},L.note),
      el('label',{class:'flex flex-col gap-2'},el('span',{class:'text-sm font-medium'},L.testName),titleInput),
      el('label',{class:'flex flex-col gap-2'},el('span',{class:'text-sm font-medium'},L.track),trackSelect),
      el('div',{class:'grid grid-cols-1 gap-4 lg:grid-cols-2'},...fields),
      el('div',{class:'flex flex-wrap gap-3'},button(L.save,false,'data-mock-author-save'),
        button(L.publish,true,'data-mock-author-publish')));
    return el('div',{class:'flex flex-col gap-6','data-mock-create-workspace':''},
      el('div',{class:'flex flex-wrap items-center justify-between gap-3'},heading(L.title,L.sub),newButton),
      state.message?el('p',{class:`panel text-sm ${state.error?'text-band-bad':'text-band-good'}`,
        role:state.error?'alert':'status','data-mock-author-result':''},state.message):null,
      form,
      el('section',{class:'flex flex-col gap-3','data-mock-existing-tests':''},
        el('h2',{class:'font-display text-xl'},L.drafts),
        ...testList.length?testList:[el('p',{class:'panel text-sm text-ink-500'},L.noMocks)]));
  },
});
