/** Private landing-equivalent CEFR level check for learner-selected planning.
 * Question selection, option ordering and final scoring are owned by the server.
 */
import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {SEQUENCE_API,ASSIGNMENTS_PATH} from './sequence-view.js';

const API=SEQUENCE_API+'/level';
const QUESTION_COUNT=17;
const LEVELS=['A1','A2','B1','B2','C1','C2'];
const SKILLS=['grammar','vocabulary','reading','listening','use'];
const text=(ctx,uz,en)=>ctx.locale==='uz'?uz:en;
const labels={
 grammar:['Grammar','Grammar'],vocabulary:['So‘z boyligi','Vocabulary'],
 reading:['Reading','Reading'],listening:['Listening','Listening'],
 use:['Use of English','Use of English'],
};
function loadStyle(){
 if(document.querySelector('link[data-plan-level-css]'))return;
 document.head.append(h('link',{rel:'stylesheet',
  href:'/modules/study-plan/level-check.css','data-plan-level-css':''}));
}
export function validateLevelForm(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_level_form');
 if(data.state==='select'){
  if(!Array.isArray(data.levels)||data.levels.join(',')!==LEVELS.join(','))
   throw Error('invalid_level_choices');
  return data;
 }
 if(data.state==='quiz'){
  if(!LEVELS.includes(data.level)||typeof data.attemptId!=='string'||
     !Array.isArray(data.questions)||data.questions.length!==QUESTION_COUNT)throw Error('invalid_level_quiz');
  const ids=new Set(),totals={};
  for(const q of data.questions){
   if(!q||typeof q.id!=='string'||ids.has(q.id)||!SKILLS.includes(q.skill)||
      typeof q.q!=='string'||!Array.isArray(q.options)||![3,4].includes(q.options.length) || (q.skill!=='listening'&&q.options.length!==4)||
      q.options.some(o=>typeof o!=='string')||q.audio!=null&&typeof q.audio!=='string'||
      q.passage!=null&&typeof q.passage!=='string')throw Error('invalid_level_question');
   ids.add(q.id);totals[q.skill]=(totals[q.skill]||0)+1;
  }
  if(SKILLS.some(s=>totals[s]!==((s==='reading'||s==='use')?4:3)))throw Error('unbalanced_level_test');
  return data;
 }
 if(data.state==='result'){
  if(!Number.isInteger(data.correct)||data.correct<0||data.correct>QUESTION_COUNT||
     data.total!==QUESTION_COUNT||!LEVELS.includes(data.level)||
     typeof data.passed!=='boolean'||!Array.isArray(data.review)||
     data.review.length!==QUESTION_COUNT||!data.skills||
     SKILLS.some(skill=>!data.skills[skill]||
       !Number.isInteger(data.skills[skill].correct)||
       data.skills[skill].total!==3))throw Error('invalid_level_result');
  return data;
 }
 throw Error('invalid_level_state');
}

function selector(ctx,state,paint,change){
 return h('div',{class:'level-choices',role:'group',
  'aria-label':text(ctx,'Sinov darajasi','Assessment level')},
 LEVELS.map(level=>h('button',{type:'button',class:'btn-secondary',
   'data-level-select':level, 'aria-pressed':state.level===level,
   disabled:state.pending,onClick:()=>{state.level=level;paint();}},
   h('strong',{},level),h('small',{},({
     A1:'Starter',A2:'Elementary',B1:'Intermediate',
     B2:'Upper intermediate',C1:'Advanced',C2:'Proficiency',
   })[level]))));
}

export function mount(ctx){
 const {root,signal}=ctx;
 loadStyle();
 const state={data:null,mode:'loading',level:'B1',index:0,answers:Array(QUESTION_COUNT).fill(null),
  pending:false,error:null,result:null};
 const page=h('div',{class:'level-check-page','data-level-check-page':''});
 root.append(page);
 const shortcut=(label,href,cls='btn-secondary')=>h('a',{href,class:cls},label);
 const toProfile=()=>shortcut(text(ctx,'Darajani profilda belgilash','Set level in profile'),
    '/app/profile?edit=level');
 const toPlan=()=>shortcut(text(ctx,'Assignments’dagi rejaga qaytish','Back to plan'),
    ASSIGNMENTS_PATH);
 const note=()=>state.error?h('p',{class:'level-check-error',role:'alert'},state.error):null;

 let mcqAudio=null;
 function stopAudio(){
  if(mcqAudio){mcqAudio.pause();mcqAudio.removeAttribute('src');mcqAudio=null;}
  if(typeof window!=='undefined'&&'speechSynthesis' in window)window.speechSynthesis.cancel();
 }
 function speak(q){
  stopAudio();
  if(!q?.audio)return;
  if(q.audio.startsWith('/api/study-plan/monthly/sequence/level/landing/audio/')){
   mcqAudio=new Audio(q.audio);
   mcqAudio.play().catch(()=>{
    if(signal.aborted)return;
    state.error=text(ctx,'MCQ audio yuklanmadi. Qayta urinib ko‘ring.',
      'The original MCQ audio could not be played. Retry.');paint();
   });
   return;
  }
  if(typeof window==='undefined'||!('speechSynthesis' in window)||
     typeof window.SpeechSynthesisUtterance!=='function'){
   state.error=text(ctx,'Brauzeringiz ovozli sinovni qo‘llamaydi.',
     'Speech playback is not available in this browser.');paint();return;
  }
  const utter=new window.SpeechSynthesisUtterance(q.audio);
  utter.lang='en-GB';utter.rate=.94;window.speechSynthesis.speak(utter);
 }
 signal.addEventListener('abort',stopAudio,{once:true});

 function selectView(){
  return h('section',{class:'card level-check-card','data-level-check-select':''},
   h('h1',{},text(ctx,'Darajani aniqlash','Find your level')),
   h('p',{class:'level-check-muted'},text(ctx,
     'Landing sahifadagi kabi Grammar, Vocabulary, Reading, Listening va Use of English bo‘yicha sinov. Darajani tanlang.',
     'The same Grammar, Vocabulary, Reading, Listening and Use of English check used on the landing page. Choose a level.')),
   selector(ctx,state,paint),
   h('p',{class:'level-check-meta'},
     text(ctx,'17 savol · 5 ko‘nikma · 15–20 daqiqa',
       '17 questions · 5 skills · 15–20 minutes')),
   h('div',{class:'level-check-actions'},
     h('button',{type:'button',class:'btn-primary',disabled:state.pending,
       'data-level-begin':'',onClick:()=>void start()},
       state.pending?ctx.dict.common.loading:text(ctx,'Testni boshlash','Start test')),
     toProfile(),toPlan()),note());
 }

 function quizView(){
  const data=state.data,q=data.questions[state.index];
  const answered=state.answers.filter(Number.isInteger).length;
  return h('section',{class:'card level-check-card','data-level-check-quiz':''},
   h('div',{class:'level-check-top'},
    h('p',{class:'level-check-meta'},'LEARNERS AREA / '+data.level),
    h('strong',{},(state.index+1)+' / '+QUESTION_COUNT)),
   h('p',{class:'level-check-meta'},labels[q.skill][ctx.locale==='uz'?0:1]+
     ' · '+answered+'/'+QUESTION_COUNT+' '+text(ctx,'javob','answered')),
   h('div',{class:'level-check-tracker',role:'group',
     'aria-label':text(ctx,'Savollarga o‘tish','Jump to question')},
     data.questions.map((item,index)=>h('button',{
      type:'button','aria-label':text(ctx,'Savol ','Question ')+(index+1),
      'aria-current':index===state.index?'step':null,
      'data-level-step':index,
      'data-answered':Number.isInteger(state.answers[index]),
      disabled:state.pending,
      onClick:()=>{stopAudio();state.index=index;paint();}
     }))),
   q.passage?h('blockquote',{class:'level-check-passage'},q.passage):null,
   q.audio?h('div',{class:'level-check-audio'},
     h('p',{},text(ctx,'Listening yozuvini tinglang','Listen to the recording')),
     h('button',{type:'button',class:'btn-secondary','data-level-play':'',
       onClick:()=>speak(q)},text(ctx,'Tinglash','Play')),
     h('button',{type:'button',class:'btn-secondary',
       onClick:stopAudio},text(ctx,'To‘xtatish','Stop'))):null,
   h('h2',{class:'level-check-question'},q.q),
   h('div',{class:'level-check-options',role:'radiogroup',
    'aria-label':text(ctx,'Javob variantlari','Answer options')},
    q.options.map((option,index)=>h('button',{
     type:'button',class:'level-check-choice',
     'data-level-answer':index,role:'radio',
     'aria-checked':state.answers[state.index]===index,
     disabled:state.pending,
     onClick:()=>{state.answers[state.index]=index;paint();}
    },h('span',{class:'level-check-letter'},'ABCD'[index]),h('span',{},option)))),
   h('div',{class:'level-check-actions'},
    h('button',{type:'button',class:'btn-secondary',disabled:state.pending,
      'data-level-restart':'',onClick:()=>{stopAudio();state.mode='select';
        state.data=null;state.answers=Array(QUESTION_COUNT).fill(null);state.index=0;
        state.error=null;paint();}},
      text(ctx,'Boshqa daraja','Choose a level')),
    h('button',{type:'button',class:'btn-secondary',disabled:state.pending||state.index===0,
      onClick:()=>{stopAudio();state.index--;paint();}},
      text(ctx,'Ortga','Previous')),
    h('button',{type:'button',class:'btn-primary',disabled:state.pending,
      'data-level-next':'',
      onClick:()=>{stopAudio();if(state.index<QUESTION_COUNT-1){state.index++;paint();}
        else if(answered===QUESTION_COUNT)void submit();else{
         state.error=text(ctx,'Barcha 17 ta savolga javob bering.',
           'Answer all 17 questions before submitting.');paint();
        }}},
      state.index===QUESTION_COUNT-1?text(ctx,'Natijani hisoblash','Show results'):
        text(ctx,'Keyingi savol','Next'))),note());
 }

 function resultView(){
  const result=state.result;
  const score=result.correct+'/'+result.total;
  const passed=result.passed;
  return h('section',{class:'card level-check-card','data-level-check-result':''},
   h('h1',{},text(ctx,'Daraja testi natijasi','Level check result')),
   h('div',{class:'level-check-score'},
     h('strong',{},score),h('span',{},result.level+' · '+
       Math.round(result.correct*100/QUESTION_COUNT)+'%')),
   h('p',{},passed?text(ctx,
     'Sinov natijasi tanlangan daraja uchun yetarli. Daraja profilga saqlandi.',
     'Your score supports this study level. Your profile has been updated.'):
     text(ctx,'Ushbu darajani tasdiqlash uchun natija yetarli emas.',
       'The score is not sufficient to confirm the selected level.')),
   h('p',{class:'level-check-muted'},text(ctx,
     'Bu qisqa diagnostika rasmiy CEFR sertifikati emas. Speaking va Writing alohida baholanishi kerak.',
     'This short check is not an official CEFR certificate. Speaking and Writing require separate assessment.')),
   h('div',{class:'level-check-skills'},
    SKILLS.map(skill=>h('p',{},
      labels[skill][ctx.locale==='uz'?0:1]+': '+
      result.skills[skill].correct+'/3'))),
   h('details',{class:'level-check-review'},
    h('summary',{},text(ctx,'Javoblar tahlili','Review all answers')),
    result.review.map((item,index)=>h('div',{class:'level-check-review-item'},
      h('strong',{},(index+1)+'. '+(item.correct?'✓':'×')),
      h('p',{},text(ctx,'Sizning javobingiz: ','Your answer: ')+item.selected),
      h('p',{},text(ctx,'To‘g‘ri javob: ','Correct answer: ')+item.answer),
      h('p',{class:'level-check-muted'},item.explanation)))),
   h('div',{class:'level-check-actions'},
    passed?h('button',{type:'button',class:'btn-primary',
      disabled:state.pending,'data-level-create-plan':'',
      onClick:()=>ctx.navigate?.(ASSIGNMENTS_PATH)},
      text(ctx,'7 yoki 30 kunlik rejani tanlash','Choose a 7- or 30-day plan')):null,
    !passed?h('button',{type:'button',class:'btn-primary',
      disabled:state.pending,onClick:()=>{state.mode='select';
       state.level=result.nextLevel||result.suggestedLevel||'A1';
       state.data=null;state.result=null;state.error=null;paint();}},
      text(ctx,'Boshqa darajani sinash','Try a different level')):null,
    toProfile(),toPlan()),note());
 }

 function paint(){
  if(signal.aborted)return;
  const heading=h('header',{class:'level-check-page-header'},
   h('a',{href:ASSIGNMENTS_PATH,class:'btn-secondary'},
    text(ctx,'← Assignments','← Assignments')));
  page.replaceChildren(heading,
   state.mode==='loading'?h('p',{role:'status'},ctx.dict.common.loading):
   state.mode==='select'?selectView():
   state.mode==='quiz'?quizView():
   state.mode==='result'?resultView():
   h('p',{role:'alert'},text(ctx,'Sinov mavjud emas.','Level check unavailable.')));
 }

 async function load(){
  state.mode='loading';paint();
  try{
   const data=validateLevelForm(await api.request(API,{signal,fresh:true}));
   if(signal.aborted)return;
   state.data=data;state.mode=data.state;state.error=null;
   if(data.state==='quiz'){
    state.level=data.level;state.answers=Array(QUESTION_COUNT).fill(null);state.index=0;
   }else state.level=data.currentLevel&&LEVELS.includes(data.currentLevel)?
    data.currentLevel:'B1';
  }catch{
   if(signal.aborted)return;state.mode='select';state.error=text(ctx,
    'Sinovni yuklab bo‘lmadi. Keyinroq qayta urinib ko‘ring.',
    'Could not load the assessment. Please try again.');
  }finally{paint();}
 }

 async function start(){
  if(state.pending)return;
  state.pending=true;state.error=null;paint();
  try{
   const data=validateLevelForm(await api.request(API+'/start',{
     method:'POST',body:{level:state.level},signal}));
   if(signal.aborted)return;
   state.data=data;state.mode='quiz';state.answers=Array(QUESTION_COUNT).fill(null);state.index=0;
  }catch{
   if(!signal.aborted)state.error=text(ctx,
     'Testni boshlashda xatolik. Qayta urinib ko‘ring.',
     'Could not start the test. Try again.');
  }finally{state.pending=false;paint();}
 }

 async function submit(){
  if(state.pending||state.answers.some(value=>!Number.isInteger(value)))return;
  state.pending=true;state.error=null;paint();
  try{
   const result=validateLevelForm(await api.request(API+'/submit',{
     method:'POST',signal,body:{attemptId:state.data.attemptId,answers:state.answers}}));
   if(signal.aborted)return;
   state.result=result;state.mode='result';
  }catch(error){
   if(!signal.aborted)state.error=error.status===409?
     text(ctx,'Test muddati tugagan. Yangisini boshlang.',
       'This attempt has expired. Start a new test.'):
     text(ctx,'Natijani tekshirib bo‘lmadi. Qayta urinib ko‘ring.',
       'Could not score the answers. Please retry.');
  }finally{state.pending=false;paint();}
 }

 paint();
 void load();
}
