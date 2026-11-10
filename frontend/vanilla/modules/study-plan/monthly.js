import {h} from '../../js/native.js';
import {asyncRegion, button, card, detail, formatDay, heading, labelSkill, link, request, text} from './view.js';

const TOPICS = {
  gist: ['Asosiy mazmun', 'Main message'],
  detail: ['Aniq ma’lumotlar', 'Specific details'],
  inference: ['Matndan xulosa chiqarish', 'Inference'],
  main_idea: ['Asosiy fikr', 'Main idea'],
  argument: ['Fikrni dalillash', 'Developing an argument'],
  cohesion: ['Fikrlarni bog‘lash', 'Cohesion'],
  precision: ['Aniq ifoda', 'Precise wording'],
  agreement: ['Ega va kesim mosligi', 'Subject–verb agreement'],
  tense: ['Fe’l zamonlari', 'Verb tenses'],
  articles: ['A, an va the', 'Articles'],
  clauses: ['Qo‘shma gaplar', 'Clauses'],
};
const PHASES = {
  foundation: ['Asoslarni mustahkamlash','Build foundations'],
  accuracy: ['Aniqlik ustida ishlash','Improve accuracy'],
  timed: ['Vaqt bilan mashq','Timed practice'],
  transfer: ['Yangi mavzuda qo‘llash','Apply to new material'],
  review: ['Tahlil va takrorlash','Review and consolidate'],
};
const PRACTICE = {
  gist: ['Avval umumiy mazmunni bir gapda yozing, keyin variantlarni solishtiring.','Write the main message in one sentence before comparing options.'],
  detail: ['Savoldagi kalit so‘zlarni belgilang va javobni yozuv yoki matndan aniq tekshiring.','Mark the key words and verify each answer against the recording or text.'],
  inference: ['Xulosani tanlang va uni tasdiqlovchi iborani belgilang.','Choose an inference and underline the phrase that supports it.'],
  main_idea: ['Har xatboshini bir jumlada jamlang, so‘ng umumiy mavzuni aniqlang.','Summarize each paragraph in one sentence, then identify the overall idea.'],
  argument: ['Bir fikr yozing. Uni sabab va aniq misol bilan rivojlantiring.','Write a claim, then develop it with a reason and a specific example.'],
  cohesion: ['Fikr, sabab va misolni bitta xatboshida tartiblang. Bog‘lovchilarni tekshiring.','Order the claim, reason and example in one paragraph. Review the transitions.'],
  precision: ['Ikki jumlani ma’nosini saqlagan holda qayta yozing.','Rewrite two sentences while keeping their original meaning.'],
  agreement: ['Ega va asosiy fe’lni toping. Moslikni tekshirib, ikki gap yozing.','Find the subject and main verb. Check agreement and write two examples.'],
  tense: ['Vaqt ko‘rsatkichlarini belgilang. Nega har bir zamonni tanlaganingizni yozing.','Mark the time clues. Explain why you chose each tense.'],
  articles: ['Otning umumiy yoki aniq ekanini tekshirib, artiklni tanlang.','Identify whether each noun is general or specific, then choose the article.'],
  clauses: ['Ergash gapni asosiy gap bilan birlashtiring va tinish belgilarini tekshiring.','Join a dependent clause to a main clause and check punctuation.'],
};
const COACH = {
  foundation: ['Namuna bilan boshlang.','Start with a worked example.'],
  accuracy: ['Xatolar sababini yozib chiqing.','Write down why each error happened.'],
  timed: ['Vaqt belgilang, oxirida xatolaringizni ko‘rib chiqing.','Set a timer and review your errors afterwards.'],
  transfer: ['Yangi yozuv, matn yoki topshiriq tanlang.','Choose a new recording, text or prompt.'],
  review: ['Oldingi xatolardan ikkitasini qayta ishlab, natijalarni taqqoslang.','Redo two earlier mistakes and compare the results.'],
};
const label = (ctx, labels, key) => labels[key] ? text(ctx,...labels[key]) : key;

function listeningPlayer(ctx, section, onComplete, error) {
  const fallback = section.canFallback ? button(text(ctx,'Boshqa yozuvni yuklash','Load an alternate recording'),async event=>{
    const control = event.currentTarget;
    control.disabled = true;
    try {
      const next = await request(ctx,'/monthly/start?fallback=true',{method:'POST'});
      if (!ctx.signal.aborted) onComplete(next);
    } catch {
      if (!ctx.signal.aborted) error.textContent = ctx.dict.errors.unknown;
    } finally {control.disabled = false;}
  },{hidden:true}) : null;
  const audio = h('audio',{controls:true,preload:'none',src:section.audio,'aria-label':text(ctx,'Listening yozuvi','Listening recording')});
  if (fallback) audio.addEventListener('error',()=>{fallback.hidden=false;});
  return h('div',{},detail(text(ctx,'Yozuvni tinglang va savollarga javob bering.','Listen to the recording and answer the questions.')),
    audio, section.credit ? detail(section.credit) : null, fallback);
}

function assessment(ctx, form, onComplete) {
  const fields = new Map();
  const sample = h('textarea',{class:'input',rows:5,required:true,maxLength:1100,name:'writing-sample'});
  const count = detail(text(ctx,'45–110 so‘z','45–110 words'));
  function words() {return sample.value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;}
  sample.addEventListener('input',()=>{count.textContent = words()+' / 45–110 '+text(ctx,'so‘z','words');});
  const error = h('p',{role:'alert',class:'text-band-bad'});
  const submit = h('button',{type:'submit',class:'btn-primary'},text(ctx,'Natijani tekshirish va reja tuzish','Score and create my plan'));

  function question(q) {
    if (!q.options.length) {
      const answer = h('input',{class:'input',type:'text',name:q.id,required:true,maxLength:100,autoComplete:'off'});
      fields.set(q.id,()=>answer.value.trim());
      return h('label',{class:'study-plan-month-question'},q.prompt,answer);
    }
    const choices = q.options.map((choice,index)=>{
      const input = h('input',{type:'radio',required:true,name:q.id,value:index});
      return {input,element:h('label',{class:'study-plan-month-choice'},input,choice)};
    });
    fields.set(q.id,()=>choices.findIndex(choice=>choice.input.checked));
    return h('fieldset',{class:'study-plan-month-question'},h('legend',{},q.prompt),choices.map(choice=>choice.element));
  }

  const sections = form.sections.map(section => card(
    heading(labelSkill(section.skill)),
    section.audio ? listeningPlayer(ctx,section,onComplete,error) : null,
    section.passages ? section.passages.map((passage,index)=>h('div',{class:'study-plan-month-question'},
      h('p',{},passage), section.questions.filter(q=>q.passage===index).map(question))) : section.questions.map(question),
    section.sample ? h('label',{class:'study-plan-month-question'},section.sample,sample,count) : null));
  return h('form',{class:'study-plan-content',onSubmit:async event=>{
    event.preventDefault();
    if (words()<45 || words()>110) {
      error.textContent = text(ctx,'Writing namunasi 45–110 so‘z bo‘lishi kerak.','The writing sample must contain 45–110 words.');
      sample.focus();
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    try {
      const next = await request(ctx,'/monthly/assessment',{method:'POST',body:{
        id:form.id,version:form.version,answers:Object.fromEntries([...fields].map(([key,value])=>[key,value()])),
        sample:sample.value.trim(),
      }});
      if (!ctx.signal.aborted) onComplete(next);
    } catch {
      if (!ctx.signal.aborted) error.textContent = text(ctx,'Javoblarni tekshiring va qayta yuboring.','Check your answers and try again.');
    } finally {submit.disabled=false;}
  }},sections,error,h('div',{class:'study-plan-actions'},submit));
}

function plan(ctx, data) {
  const finished = data.state === 'finished';
  const days = data.days;
  const totals = days.flatMap(day=>day.tasks);
  const done = totals.filter(task=>task.status==='practiced').length;
  const active = days.find(day=>day.date>=data.today) ?? days.at(-1);
  const activePage = Math.floor(days.indexOf(active)/7);
  const daysHost = h('div',{class:'study-plan-content'});
  const pages = h('div',{class:'study-plan-actions',role:'group','aria-label':text(ctx,'Reja haftalari','Plan weeks')});

  function draw(page) {
    for (const [index, control] of [...pages.children].entries()) {
      control.className = index===page?'btn-primary':'btn-secondary';
      control.setAttribute('aria-pressed',String(index===page));
    }
    daysHost.replaceChildren(...days.slice(page*7,page*7+7).map(day=>h('article',{
      class:'study-plan-month-day','data-month-day':day.date,
    }, h('h3',{},formatDay(ctx,day.date,true)),detail(label(ctx,PHASES,day.phase)),
    day.tasks.length ? h('ul',{class:'study-plan-tasks'},day.tasks.map(task=>h('li',{class:'study-plan-task'},
      h('div',{class:'study-plan-task-description'},
        h('strong',{},labelSkill(task.skill)+' · '+label(ctx,TOPICS,task.topic)),
        detail(task.minutes+' '+text(ctx,'daq.','min')+' · '+label(ctx,COACH,task.phase)),
        detail(label(ctx,PRACTICE,task.topic))),
      task.status==='practiced'?h('span',{class:'badge'},text(ctx,'Faoliyat qayd etildi','Practice logged')):
        task.status==='missed'?h('span',{class:'badge'},text(ctx,'O‘tkazib yuborildi','Missed')):
          link(text(ctx,'Mashq qilish','Practise'),task.href,'btn-primary')))) :
      detail(text(ctx,'Dam olish kuni','Rest day')))));
  }
  for (let page=0;page<Math.ceil(days.length/7);page++) {
    pages.append(button(page===4?text(ctx,'Yakuniy kunlar','Final days'):
      text(ctx,(page+1)+'-hafta','Week '+(page+1)),()=>draw(page)));
  }
  draw(activePage);

  const diagnostic = h('div',{class:'study-plan-metrics'},Object.entries(data.diagnosis).map(([skill,score])=>{
    const topics = Object.entries(score.topics).sort(([,a],[,b])=>a.correct/a.total-b.correct/b.total);
    return h('div',{class:'study-plan-metric'},h('strong',{},labelSkill(skill)+' · '+score.correct+'/'+score.total),
      topics.map(([topic,result])=>detail(label(ctx,TOPICS,topic)+' · '+result.correct+'/'+result.total)),
      score.sample?detail(score.sample.words+' '+text(ctx,'so‘zli namuna','words in sample')):null);
  }));
  return [card(heading(text(ctx,finished?'30 kunlik sikl yakunlandi':'Sizning 30 kunlik rejangiz',
    finished?'30-day cycle finished':'Your 30-day plan')),
    detail(formatDay(ctx,data.from)+' – '+formatDay(ctx,data.through)),
    detail(done+'/'+totals.length+' '+text(ctx,'faoliyat qayd etildi','activities logged')),
    detail(text(ctx,'Ustuvor mavzular mini-test xatolaridan olinadi. Reja keyingi kunlarda bajarilgan mashqlar va vaqtingizga qarab yangilanadi.',
      'Priorities come from your diagnostic answers. Upcoming days adapt to your available time and recorded practice.')),
    diagnostic),card(heading(text(ctx,'30 kunlik kalendar','30-day calendar')),pages,daysHost)];
}

export function mountMonthly(ctx, host, showWeekly) {
  const refresh = asyncRegion(ctx,host,()=>request(ctx,'/monthly'),draw);
  let state;
  function draw(data) {
    state = data.state;
    if (data.state==='setup') {
      host.dataset.setup = 'true';
      host.replaceChildren(card(heading(text(ctx,'O‘qish vaqtingizni belgilang','Set your study time')),
        detail(text(ctx,'Avval haftalik sozlamalarda maqsad, o‘qish kunlari va kunlik vaqtni saqlang.',
          'First save your goal, study days and daily time in the weekly settings.')),
        button(text(ctx,'Haftalik sozlamalarga o‘tish','Go to weekly settings'),showWeekly)));
      return;
    }
    if (data.state==='assessment') {
      host.replaceChildren(card(heading(text(ctx,'Darajani aniqlash mini-testi','Placement mini-test')),
        detail(text(ctx,'To‘rtta bo‘limni bajaring. Natija mashq rejasini tuzish uchun ishlatiladi.',
          'Complete all four sections. The result is used to build your practice plan.'))),assessment(ctx,data.form,draw));
      return;
    }
    const error = h('p',{role:'alert',class:'text-band-bad'});
    const start = button(text(ctx,data.state==='finished'?'Yangi siklni boshlash':'Mini-testni boshlash',
      data.state==='finished'?'Start another cycle':'Start the mini-test'),async event=>{
      const control = event.currentTarget;
      control.disabled = true;
      try {
        const next = await request(ctx,'/monthly/start',{method:'POST'});
        if (!ctx.signal.aborted) draw(next);
      } catch {
        if (!ctx.signal.aborted) error.textContent = ctx.dict.errors.unknown;
      } finally {control.disabled=false;}
    },{class:'btn-primary'});
    const intro = card(heading(text(ctx,'Ixtiyoriy 30 kunlik reja','Optional 30-day plan')),
      detail(text(ctx,'Listening, Reading, Writing va Grammar bo‘yicha qisqa mini-test topshiring. Writing namunasi IELTS bandiga aylantirilmaydi.',
        'Take a short Listening, Reading, Writing and Grammar diagnostic. The writing sample is used for planning and has no IELTS band.')),
      h('div',{class:'study-plan-actions'},start),error);
    host.replaceChildren(...(data.state==='active'?plan(ctx,data):data.state==='finished'?[...plan(ctx,data),intro]:[intro]));
  }
  void refresh();
  ctx.onResume?.(()=>{if (!host.hidden && ['active','finished'].includes(state)) void refresh({background:true});});
}
