/** Dedicated Mock material imports + canonical Speaking-topic selection.
 * Only full Listening, Academic Reading and Writing Exam sources are available.
 */
import {el, listen, mountStaff, heading} from './kit.js';
import {api} from '../../js/api-client.js';
import {renderMockPreview} from '../mocks/preview.js';

const UPLOAD_SLOTS = [
  ['listening','Listening — 40 questions','Listening — 40 savol','listening'],
  ['reading','Reading — 40 questions','Reading — 40 savol','reading'],
  ['writingTask1','Writing Task 1','Writing Task 1','task1'],
  ['writingTask2','Writing Task 2','Writing Task 2','task2'],
];
const LANG = {
  uz:{title:'Mock yaratish',sub:'Listening, Reading va Writing uchun yangi Mock materiallarini yuklang. Speaking savollarini mavjud bankdan tanlang.',
    testName:'Imtihon nomi',track:'Yo‘nalish',academic:'Academic',general:'General Training',
    blank:'Mock materiali tanlanmagan',noVersions:'Hali Mock uchun yuklangan material yo‘q.',
    save:'Draft saqlash',publish:'Tekshirish va qulflab saqlash',drafts:'Mock testlar',
    locked:'Qulflangan',open:'Ochiq',lock:'Qulflash',unlock:'Qulfni ochish',preview:'Ko‘rish',accessSaved:'Kirish holati saqlandi.',
    noMocks:'Hozircha Mock test yaratilmagan.',edit:'Tahrirlash',newMock:'Yangi Mock',
    draft:'Qoralama',published:'Nashr qilingan',saved:'Draft saqlandi.',publishedNotice:'Mock nashr qilindi.',
    error:'Saqlash amalga oshmadi.',note:'Listening/Reading: 40 ta haqiqiy savol va answer key mavjud JSON. Listening uchun audio, Task 1 uchun rasm yuklang. Speaking Part 1–3 mavzularini tanlang.',
    upload:'Yangi Mock materialini yuklash',json:'Material JSON',media:'Audio / Task 1 rasm',
    uploaded:'Yangi Mock materiali yuklandi.',speaking:'Speaking — saytdagi mavjud savollar',
    p1:'Part 1 — mavzu',p2:'Part 2 — cue card',p3:'Part 3 — mavzu',noTopic:'Mavzu tanlanmagan',
    mode:'Speaking savollarini taqsimlash',fixed:'Hamma talabaga bir xil to‘plam',auto:'Har bir talabaga avtomatik tasodifiy to‘plam',
    autoHint:'Part 1 tasodifiy mavzu, Part 2 tasodifiy cue card, Part 3 esa aynan tanlangan Part 2 ga bog‘langan savollardan olinadi. Tanlov har bir talabada bir marta saqlanadi.',
    chooseMode:'Material manbasi',newMode:'Yangi material yuklash',existingMode:'Saytdagi testlardan tanlash',chooseExisting:'Exam Mode testi',bind:'Mock uchun tanlash',noExisting:'Mos Exam Mode materiali topilmadi.',disabled:'Nashr qilingan Mock tahrirlanmaydi.'},
  en:{title:'Create Mock',sub:'Upload new Mock-only Listening, Reading and Writing material. Select Speaking topics from the existing bank.',
    testName:'Exam title',track:'Track',academic:'Academic',general:'General Training',
    blank:'No Mock material selected',noVersions:'No dedicated Mock material uploaded yet.',
    save:'Save draft',publish:'Validate & save locked',drafts:'Mock tests',
    locked:'Locked',open:'Open',lock:'Lock',unlock:'Unlock',preview:'Preview',accessSaved:'Access updated.',
    noMocks:'No Mock tests created yet.',edit:'Edit',newMock:'New Mock',
    draft:'Draft',published:'Published',saved:'Draft saved.',publishedNotice:'Mock published.',
    error:'Unable to save.',note:'Listening/Reading require JSON with 40 real questions and answer keys. Listening needs audio; Task 1 needs an image. Select Speaking Part 1–3 topics.',
    upload:'Upload new Mock material',json:'Material JSON',media:'Audio / Task 1 image',
    uploaded:'New Mock material uploaded.',speaking:'Speaking — existing question bank',
    p1:'Part 1 topic',p2:'Part 2 cue card',p3:'Part 3 topic',noTopic:'No topic selected',
    mode:'Speaking question assignment',fixed:'Same questions for all students',auto:'Auto-select different questions per student',
    autoHint:'Random Part 1 topic and Part 2 cue card; Part 3 is taken exclusively from that Part 2 follow-up link. Saved once per attempt.',
    chooseMode:'Material source',newMode:'Upload new material',existingMode:'Select from existing tests',chooseExisting:'Exam Mode test',bind:'Use in Mock',noExisting:'No eligible Exam Mode materials found.',disabled:'Published mocks are immutable.'},
};

export const mockCreateMount=mountStaff({
  name:'mock-create',roles:['teacher','owner'],
  load:ctx=>api.request('/api/staff/mocks/authoring',{signal:ctx.signal,fresh:true}),
  render(ctx,data,view){
    const L=LANG[ctx.locale==='uz'?'uz':'en'];
    const {signal}=ctx;
    const state=ctx.state.mockComposer??={id:null,title:'',track:'academic',sections:{},speakingTopics:{},speakingMode:'fixed',sourceModes:{},busy:false,message:'',error:false};
    if(state.preview)return renderMockPreview(state.preview,{signal,locale:ctx.locale,onClose:()=>{state.preview=null;view.rerender();}});
    const notify=(text,error=false)=>{state.message=text;state.error=error;view.rerender();};
    const newButton=el('button',{type:'button',class:'btn-secondary','data-mock-author-new':''},L.newMock);
    listen(newButton,'click',()=>{Object.assign(state,{id:null,title:'',track:'academic',sections:{},speakingTopics:{},speakingMode:'fixed',sourceModes:{},message:'',error:false});view.rerender();},signal);
    const titleInput=el('input',{class:'input w-full',required:'',maxlength:'160',value:state.title,
      'aria-label':L.testName,'data-mock-author-title':''});
    listen(titleInput,'input',()=>{state.title=titleInput.value;},signal);
    const trackSelect=el('select',{class:'input w-full','aria-label':L.track,'data-mock-author-track':''},
      el('option',{value:'academic'},L.academic),el('option',{value:'general'},L.general));
    trackSelect.value=state.track;
    listen(trackSelect,'change',()=>{state.track=trackSelect.value;state.sections={};view.rerender();},signal);

    const fields=UPLOAD_SLOTS.map(([key,en,uz,contentType])=>{
      const label=ctx.locale==='uz'?uz:en;
      const versions=(data.versions||[]).filter(v=>v.module==='mock' && v.contentType===contentType && v.track===state.track);
      const select=el('select',{class:'input w-full','aria-label':label,'data-mock-author-section':key},
        el('option',{value:''},L.blank),
        ...versions.map(v=>el('option',{value:v.id},`${v.title} · v${v.version||1}`)));
      select.value=state.sections[key]||'';
      listen(select,'change',()=>{state.sections[key]=select.value;},signal);
      const current=(data.existingSources||{})[key]||[];
      const selectedSource=el('select',{class:'input w-full','data-mock-existing-select':key,'aria-label':L.chooseExisting},el('option',{value:''},L.blank),...current.map(x=>el('option',{value:x.id},x.title)));
      const sourceMode=el('select',{class:'input w-full','data-mock-source-mode':key,'aria-label':L.chooseMode},el('option',{value:'existing'},L.existingMode),el('option',{value:'new'},L.newMode));
      sourceMode.value=state.sourceModes[key]||'existing';
      listen(sourceMode,'change',()=>{state.sourceModes[key]=sourceMode.value;view.rerender();},signal);
      const useExisting=el('button',{type:'button',class:'btn-secondary btn-sm','data-mock-existing-bind':key},L.bind);
      listen(useExisting,'click',async()=>{if(state.busy||signal.aborted||!selectedSource.value)return;state.busy=true;useExisting.disabled=true;try{const result=await api.request('/api/staff/mocks/existing',{method:'POST',body:{slot:key,track:state.track,sourceId:selectedSource.value},signal});if(signal.aborted)return;state.sections[key]=result.id;state.error=false;state.message=L.saved;await view.reload();}catch(e){if(!signal.aborted)notify(`${L.error} (${e.code||'source_failed'})`,true);}finally{state.busy=false;useExisting.disabled=false;}},signal);
      const nameInput=el('input',{type:'text',class:'input w-full',maxlength:'160',
        placeholder:ctx.locale==='uz'?'Yangi material nomi':'New material title',
        'aria-label':`${label} title`,'data-mock-material-title':key});
      const file=el('input',{type:'file',accept:'.json,application/json','aria-label':`${label} ${L.json}`,
        class:'block w-full text-xs','data-mock-material-json':key});
      const media=(key==='listening'||key==='writingTask1')?el('input',{type:'file',
        accept:key==='listening'?'audio/*,.webm,.ogg,.mp3,.m4a,.wav':'.png,.jpg,.jpeg,image/png,image/jpeg',
        class:'block w-full text-xs','aria-label':`${label} ${L.media}`,'data-mock-material-media':key}):null;
      const upload=el('button',{type:'button',class:'btn-secondary btn-sm',
        'data-mock-material-upload':key},L.upload);
      listen(upload,'click',async()=>{
        if(state.busy||signal.aborted)return;
        const document=file.files?.[0];
        if(!document){notify(`${label}: ${L.json}`,true);return;}
        if((key==='listening'||key==='writingTask1'&&state.track==='academic')&&!media?.files?.[0]){
          notify(`${label}: ${L.media}`,true);return;}
        state.busy=true;upload.disabled=true;
        try{
          const form=new FormData();
          form.set('slot',key);form.set('track',state.track);
          const originalName=document.name.replace(/\.json$/i,'').trim();
          form.set('title',(nameInput.value.trim()||originalName||label).slice(0,150));
          form.set('material',document,document.name);
          if(media?.files?.[0])form.set('media',media.files[0],media.files[0].name);
          const result=await api.request('/api/staff/mocks/materials',{method:'POST',body:form,signal,timeoutMs:120000});
          if(signal.aborted)return;
          state.sections[key]=result.id;
          state.message=L.uploaded;state.error=false;
          await view.reload();
        }catch(e){if(!signal.aborted)notify(`${L.error} (${e.code||'upload_failed'})`,true);}
        finally{state.busy=false;upload.disabled=false;}
      },signal);
      return el('div',{class:'panel flex flex-col gap-3','data-mock-material-slot':key},
        el('label',{class:'flex flex-col gap-2 text-sm text-ink-700'},el('span',{class:'font-medium'},label),select),
        versions.length?null:el('p',{class:'text-xs text-band-warn'},L.noVersions),
        el('label',{class:'flex flex-col gap-2 text-sm'},el('span',{},L.chooseMode),sourceMode),
        sourceMode.value==='existing'?el('div',{class:'flex flex-col gap-3 border-t border-ink-100 pt-3'},selectedSource,current.length?useExisting:el('p',{class:'text-xs text-ink-500'},L.noExisting)):
          el('div',{class:'flex flex-col gap-2 border-t border-ink-100 pt-3'},nameInput,file,media,upload));
    });

    const speakingMode=el('select',{class:'input w-full','data-mock-speaking-mode':'','aria-label':L.mode},
      el('option',{value:'fixed'},L.fixed),el('option',{value:'auto'},L.auto));
    speakingMode.value=state.speakingMode||'fixed';
    listen(speakingMode,'change',()=>{state.speakingMode=speakingMode.value;state.sections.speaking='';view.rerender();},signal);
    const speakingFields=['P1','P2','P3'].map((part,index)=>{
      const options=(data.speakingTopics||[]).filter(row=>row.part===part);
      const label=[L.p1,L.p2,L.p3][index];
      const select=el('select',{class:'input w-full','data-mock-speaking-topic':part,'aria-label':label},
        el('option',{value:''},L.noTopic),
        ...options.map(row=>el('option',{value:row.topic},`${row.topic} (${row.count})`)));
      select.value=state.speakingTopics?.[part]||'';
      listen(select,'change',()=>{
        state.speakingTopics[part]=select.value;
        state.sections.speaking=''; // regenerate a version-bound snapshot from the actual bank
      },signal);
      return el('label',{class:'flex flex-col gap-2'},el('span',{class:'text-sm font-medium'},label),select);
    });
    const speaking=el('section',{class:'panel flex flex-col gap-3','data-mock-speaking-bank':''},
      el('h2',{class:'font-display text-lg text-ink-900'},L.speaking),
      el('label',{class:'flex flex-col gap-2'},el('span',{class:'text-sm font-medium'},L.mode),speakingMode),
      state.speakingMode==='auto'
        ?el('p',{class:'text-sm text-ink-500','data-mock-speaking-auto-hint':''},L.autoHint)
        :el('div',{class:'grid grid-cols-1 gap-3 lg:grid-cols-3'},...speakingFields));

    const button=(label,publish,attr)=>{
      const b=el('button',{type:'button',class:publish?'btn-primary':'btn-secondary',disabled:state.busy,[attr]:''},label);
      listen(b,'click',async()=>{
        if(state.busy||signal.aborted)return;
        if(state.title.trim().length<3){notify(L.testName,true);return;}
        state.busy=true;b.disabled=true;
        try{
          const result=await api.request('/api/staff/mocks/authoring',{
            method:'POST',signal,body:{id:state.id,title:state.title.trim(),track:state.track,
              sections:state.sections,speakingTopics:state.speakingTopics,speakingMode:state.speakingMode,publish,locked:true},
          });
          if(signal.aborted)return;
          state.id=publish?null:result.testId;
          if(result.speakingVersionId)state.sections.speaking=result.speakingVersionId;
          if(publish){state.title='';state.sections={};state.speakingTopics={};state.speakingMode='fixed';}
          state.message=publish?L.publishedNotice:L.saved;
          state.error=false;await view.reload();
        }catch(err){if(!signal.aborted)notify(`${L.error} (${err.code||'request_failed'})`,true);}
        finally{state.busy=false;b.disabled=false;}
      },signal);return b;
    };
    const testList=(data.tests||[]).map(test=>el('div',{class:'panel flex flex-wrap items-center justify-between gap-3','data-mock-author-test':test.id},
      el('div',{class:'flex flex-col gap-1'},el('strong',{class:'text-sm text-ink-900'},test.title),
        el('span',{class:'text-xs text-ink-500'},`${test.track} · ${test.status==='published'?L.published:L.draft} · ${test.status==='published'?(test.locked?L.locked:L.open):L.locked}`)),
      el('div',{class:'flex flex-wrap gap-2'},
        (()=>{const b=el('button',{type:'button',class:'btn-secondary btn-sm','data-mock-author-preview':test.id},L.preview);
          listen(b,'click',async()=>{if(state.busy||signal.aborted)return;state.busy=true;b.disabled=true;
            try{const result=await api.request(`/api/staff/mocks/${encodeURIComponent(test.id)}/preview`,{signal,fresh:true});
              if(!signal.aborted){state.preview=result;view.rerender();}}
            catch(e){if(!signal.aborted)notify(`${L.error} (${e.code||'preview_failed'})`,true);}
            finally{state.busy=false;b.disabled=false;}},signal);return b;})(),
        test.status==='published'?(()=>{const b=el('button',{type:'button',class:'btn-secondary btn-sm','data-mock-author-access':test.id,'aria-pressed':String(test.locked)},test.locked?L.unlock:L.lock);
          listen(b,'click',async()=>{if(state.busy||signal.aborted)return;state.busy=true;b.disabled=true;
            try{await api.request(`/api/staff/mocks/${encodeURIComponent(test.id)}/access`,{method:'PATCH',body:{locked:!test.locked},signal});
              if(!signal.aborted){state.message=L.accessSaved;state.error=false;await view.reload();}}
            catch(e){if(!signal.aborted)notify(`${L.error} (${e.code||'access_failed'})`,true);}
            finally{state.busy=false;b.disabled=false;}},signal);return b;})():null),
      test.status==='draft'?(()=>{const b=el('button',{type:'button',class:'btn-secondary btn-sm','data-mock-author-edit':test.id},L.edit);
        listen(b,'click',()=>{Object.assign(state,{id:test.id,title:test.title,track:test.track,
          sections:{...test.sections},speakingTopics:{...(test.speakingTopics||{})},
          speakingMode:test.speakingMode||'fixed',message:'',error:false});view.rerender();},signal);return b;})():null));
    const form=el('section',{class:'panel flex flex-col gap-4','data-mock-authoring-form':''},
      el('p',{class:'text-sm text-ink-500'},L.note),
      el('label',{class:'flex flex-col gap-2'},el('span',{class:'text-sm font-medium'},L.testName),titleInput),
      el('label',{class:'flex flex-col gap-2'},el('span',{class:'text-sm font-medium'},L.track),trackSelect),
      el('div',{class:'grid grid-cols-1 gap-4 lg:grid-cols-2'},...fields),speaking,
      el('div',{class:'flex flex-wrap gap-3'},button(L.save,false,'data-mock-author-save'),button(L.publish,true,'data-mock-author-publish')));
    return el('div',{class:'flex flex-col gap-6','data-mock-create-workspace':''},
      el('div',{class:'flex flex-wrap items-center justify-between gap-3'},heading(L.title,L.sub),newButton),
      state.message?el('p',{class:`panel text-sm ${state.error?'text-band-bad':'text-band-good'}`,
        role:state.error?'alert':'status','data-mock-author-result':''},state.message):null,
      form,el('section',{class:'flex flex-col gap-3','data-mock-existing-tests':''},
        el('h2',{class:'font-display text-xl'},L.drafts),
        ...(testList.length?testList:[el('p',{class:'panel text-sm text-ink-500'},L.noMocks)])));
  },
});
