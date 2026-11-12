/** UI projections for the server-owned 7- or 30-day sequential plan.
 * The calendar never unlocks activities or invents completion in the browser.
 */
import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {grammarPracticeHref} from '../grammar/practice-route.js';

export const SEQUENCE_API = '/api/study-plan/monthly/sequence';
export const ASSIGNMENTS_PATH = '/app/assignments#study-plan-30';
const TOTAL_DAYS = 30;
const DURATIONS = [7, TOTAL_DAYS];
const DAILY_MINUTES = 120;
const KINDS = ['grammar','reading','listening','writing','speaking','vocabulary'];
const STATES = ['ready','locked','completed'];
const DAY_STATES = ['active','locked','completed'];
const text = (ctx, uz, en) => ctx.locale === 'uz' ? uz : en;

function stylesheet() {
  if (document.querySelector('link[data-study-sequence-css]')) return;
  document.head.append(h('link', {
    rel:'stylesheet', href:'/modules/study-plan/sequence.css',
    'data-study-sequence-css':'',
  }));
}

function dateLabel(ctx, date) {
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(ctx.locale === 'uz' ? 'uz-UZ' : 'en-US', {
    day:'numeric', month:'short', timeZone:'UTC',
  }).format(parsed);
}

function validRoute(href) {
  return typeof href === 'string' && /^\/app(?:\/|\?|$)/.test(href) &&
    !/[\\\u0000-\u001f]/.test(href) && !href.startsWith('//');
}

/** Narrow contract: a malformed response cannot expose a locked task as a link. */
export function validateSequence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_plan');
  if (value.state === 'level_required') return value;
  if (value.state === 'available') {
    if (value.totalDays !== TOTAL_DAYS || value.dailyMinutes !== DAILY_MINUTES ||
        typeof value.level !== 'string') throw Error('invalid_plan');
    return value;
  }
  if (!['active','completed'].includes(value.state) ||
      !DURATIONS.includes(value.totalDays) || !Number.isInteger(value.currentDay) ||
      value.currentDay < 1 || value.currentDay > value.totalDays ||
      !Number.isInteger(value.completedDays) || value.completedDays < 0 ||
      value.completedDays > value.totalDays || !Array.isArray(value.days) ||
      value.days.length !== value.totalDays) throw Error('invalid_plan');
  for (const [index, day] of value.days.entries()) {
    if (!day || day.day !== index + 1 || !DAY_STATES.includes(day.status) ||
        typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        day.minutes !== DAILY_MINUTES || !Array.isArray(day.tasks) ||
        day.tasks.length !== KINDS.length) throw Error('invalid_day');
    let total = 0;
    for (const [slot, task] of day.tasks.entries()) {
      if (!task || task.slot !== slot || task.kind !== KINDS[slot] ||
          typeof task.title !== 'string' || !task.title.trim() ||
          !STATES.includes(task.status) || !Number.isInteger(task.minutes) ||
          task.minutes <= 0 || task.minutes > 90) throw Error('invalid_task');
      total += task.minutes;
      if (task.status === 'ready') {
        if (day.status !== 'active' || day.day !== value.currentDay ||
            !validRoute(task.href)) throw Error('invalid_unlocked_task');
      } else if (task.href != null) throw Error('locked_route_exposed');
    }
    if (total !== DAILY_MINUTES || (day.status === 'locked' &&
        day.tasks.some(task => task.status === 'ready'))) throw Error('invalid_workload');
  }
  return value;
}

function metric(label, value) {
  return h('div', {class:'sequence-metric'},
    h('strong', {}, value),
    h('span', {}, label));
}

function durationPicker(ctx, selected, onChoose, minimum = 1, disabled = false) {
  return h('div', {class:'sequence-duration-picker', role:'group',
    'aria-label':text(ctx,'Reja davomiyligi','Plan duration')},
    DURATIONS.map(days=>h('button', {type:'button',
      class:'btn-secondary sequence-duration-choice',
      'data-plan-duration':days, 'aria-pressed':String(selected===days),
      disabled:disabled || days<minimum, onClick:()=>onChoose(days)},
    text(ctx,days+' kun',days+' days'))));
}

function errorNotice(ctx, onRetry, message) {
  return h('div', {class:'sequence-notice', role:'alert'},
    h('p', {}, message ?? text(ctx,
      'Rejani yuklashda xato. Qayta urinib ko‘ring.',
      'Could not load the plan. Please retry.')),
    h('button', {type:'button', class:'btn-secondary', onClick:onRetry},
      text(ctx, 'Qayta urinish', 'Retry')));
}

function statusLabel(ctx, status) {
  return ({
    completed:text(ctx,'Bajarilgan','Completed'),
    ready:text(ctx,'Boshlash','Start'),
    locked:text(ctx,'Qulflangan','Locked'),
  })[status];
}

function taskList(ctx, day) {
  return h('ul', {class:'sequence-task-list', 'data-sequence-day-tasks':day.day},
    day.tasks.map(task=>h('li', {
      class:'sequence-task', 'data-sequence-task-kind':task.kind,
      'data-sequence-task-status':task.status,
    },
    h('span', {class:'sequence-task-mark', 'aria-hidden':'true'},
      task.status === 'completed' ? '✓' : task.status === 'locked' ? '⌁' : '○'),
    h('div', {class:'sequence-task-description'},
      h('strong', {}, task.title),
      h('span', {class:'sequence-subtitle'},
        task.kind[0].toUpperCase()+task.kind.slice(1)+' · '+task.minutes+' '+
        text(ctx,'daqiqa','min'))),
    task.status === 'ready' ?
      h('a', {href:task.href.startsWith('/app/grammar')?
          grammarPracticeHref(task.href,{fromPlan:true}):task.href,
        class:'btn-primary sequence-task-action',
        'data-sequence-task-open':task.kind}, statusLabel(ctx,task.status)) :
      h('span', {class:'sequence-task-status','data-sequence-task-label':task.status},
        statusLabel(ctx,task.status)))));
}

function calendar(ctx, data, state) {
  const selected = state.selectedDay ?? data.currentDay;
  const host = h('div', {class:'sequence-detail'});
  const buttons = [];
  const labels = text(ctx,
    ['Du','Se','Ch','Pa','Ju','Sh','Ya'],
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
  const headers = labels.map(name=>h('span',{class:'sequence-weekday'},name));
  const startDay = new Date(data.days[0].date+'T00:00:00Z').getUTCDay();
  const offset = (startDay + 6)%7;
  const blanks = Array.from({length:offset},()=>h('span',{'aria-hidden':'true'}));
  for (const day of data.days) {
    const locked = day.status === 'locked';
    const button = h('button', {
      type:'button',class:'sequence-day', 'data-sequence-day':day.day,
      'data-sequence-state':day.status, 'data-sequence-today':day.date===data.today,
      'data-sequence-rescheduled':String(day.rescheduled===true),
      'aria-pressed':day.day===selected,
      'aria-label':text(ctx,'Kun ','Day ')+day.day+' — '+dateLabel(ctx,day.date)+' — '+
        (locked?statusLabel(ctx,'locked'):day.status==='completed'?
         statusLabel(ctx,'completed'):statusLabel(ctx,'ready')),
      disabled:locked,
      onClick:()=>{state.selectedDay=day.day;drawSelected();},
    }, h('strong',{},day.day),
    h('small',{},dateLabel(ctx,day.date),day.rescheduled===true?
      h('span',{class:'sequence-day-shifted',title:text(ctx,
        'Tugallanmagan mashqlar yangi sanaga ko‘chirildi',
        'Unfinished exercises moved to this date'),'aria-label':text(ctx,
        'Ko‘chirildi','Rescheduled')},' ↻'):null),
    h('span',{class:'sequence-day-dots','aria-hidden':'true'},
      day.tasks.map(task=>h('i',{'data-kind':task.kind,'data-state':task.status}))));
    buttons.push(button);
  }

  function drawSelected() {
    const selectedDay = data.days[(state.selectedDay ?? data.currentDay)-1];
    for (const button of buttons) button.setAttribute('aria-pressed',
      String(Number(button.dataset.sequenceDay)===selectedDay.day));
    host.replaceChildren(
      h('div',{class:'sequence-detail-heading'},
        h('div',{},
          h('h3',{},text(ctx,'Kun ','Day ')+selectedDay.day+' · '+
            dateLabel(ctx,selectedDay.date)),
          h('p',{class:'sequence-subtitle'},
            selectedDay.status==='completed'?text(ctx,'Kun yakunlangan','Day completed'):
            text(ctx,'Hamma vazifani bajaring, keyingi kun ochiladi.',
              'Complete every task to unlock the next day.'))),
        h('strong',{},selectedDay.tasks.filter(task=>task.status==='completed').length+
          ' / '+selectedDay.tasks.length)),
      taskList(ctx,selectedDay));
  }
  drawSelected();
  const selector = h('div',{class:'sequence-calendar-scroll'},
    h('div',{class:'sequence-calendar',role:'group',
      'aria-label':text(ctx,data.totalDays+' kunlik kalendar',data.totalDays+'-day calendar')},
      headers,blanks,buttons));
  return h('div',{class:'sequence-calendar-layout'},
    h('div',{class:'sequence-calendar-column'},selector,
      h('div',{class:'sequence-dots-legend',
        'aria-label':text(ctx,'Mashq ranglari','Exercise colors')},
        KINDS.map(kind=>h('span',{class:'sequence-dots-legend-item'},
          h('i',{'data-kind':kind,'aria-hidden':'true'}),
          text(ctx,({grammar:'Grammatika',reading:'O‘qish',listening:'Tinglash',
            writing:'Yozish',speaking:'Gapirish',vocabulary:'Lug‘at'})[kind],
            kind[0].toUpperCase()+kind.slice(1)))))),host);
}

/**
 * Attach independently from teacher assignments. No assignment list request is
 * delayed or invalidated if the plan endpoint fails.
 */
export function mountSequenceAssignments(ctx, root) {
  if (!['student','owner'].includes(ctx.session?.user?.role)) return;
  stylesheet();
  const state = {data:null,selectedDay:null,selectedDuration:TOTAL_DAYS,pending:false,confirming:false,error:null};
  const panel = h('section',{class:'sequence-section','data-study-plan-30':'',
    id:'study-plan-30','aria-label':text(ctx,'O‘quv rejasi','Learning plan')});
  root.append(panel);

  function paint() {
    if (ctx.signal.aborted) return;
    const data=state.data;
    const selectedDays=data?.state==='active'||data?.state==='completed'
      ? data.totalDays : state.selectedDuration;
    const title=h('h2',{},text(ctx,
      'Sizning '+selectedDays+' kunlik rejangiz','Your '+selectedDays+'-day plan'));
    const lead=h('p',{class:'sequence-subtitle'},
      text(ctx,'Kuniga kamida 120 daqiqa ajrating. Barcha vazifalar tugagach keyingi kun ochiladi.',
        'Allocate at least 120 minutes each day. The next day unlocks after all tasks are completed.'));
    const toolbar=h('div',{class:'sequence-heading'},h('div',{},title,lead));
    if (state.pending && !data) {
      panel.replaceChildren(toolbar,h('p',{role:'status'},ctx.dict.common.loading));return;
    }
    if (state.error && !data) {
      panel.replaceChildren(toolbar,errorNotice(ctx,()=>void load(),state.error));return;
    }
    if (!data) {panel.replaceChildren(toolbar);return;}
    if (data.state==='level_required') {
      panel.replaceChildren(toolbar,
        h('div',{class:'sequence-notice',role:'group','data-plan-level-prompt':''},
          h('p',{},text(ctx,
            'Darajangiz hali belgilanmagan. Reja tuzishdan oldin darajani aniqlashingiz mumkin.',
            'Your level is not set. Take the level check before creating your plan.')),
          h('div',{class:'sequence-controls'},
            h('a',{href:'/app/plan/level-check',class:'btn-primary',
              'data-plan-level-test':''},
              text(ctx,'Darajani aniqlash','Take level check')),
            h('a',{href:'/app/profile?edit=level',class:'btn-secondary',
              'data-plan-level-profile':''},
              text(ctx,'Yo‘q, profilda belgilayman','No, set it in profile')))));
      return;
    }
    if (data.state==='available') {
      const launch=h('button',{type:'button',class:'btn-primary',
        disabled:state.pending,onClick:()=>void change('start')},
        state.pending?ctx.dict.common.loading:text(ctx,'Rejani yaratish','Create plan'));
      panel.replaceChildren(toolbar,h('div',{class:'sequence-empty'},
        durationPicker(ctx,state.selectedDuration,days=>{state.selectedDuration=days;paint();},1,state.pending),
        metric(text(ctx,'Kun','Days'),state.selectedDuration),metric(text(ctx,'Kunlik minimum ajratishingiz kerak bo‘lgan vaqt',
          'Minimum daily study time to allocate'),'120 min'),
        h('p',{},text(ctx,'Daraja: ','Level: ')+data.level),
        launch),...(state.error?[h('p',{role:'alert'},state.error)]:[]));
      return;
    }
    const buttons=h('div',{class:'sequence-controls'},
      h('button',{type:'button',class:'btn-secondary',disabled:state.pending,
        onClick:()=>void load()},
        text(ctx,'Yangilash','Refresh')),
      data.state==='active'?h('button',{type:'button',class:'btn-secondary',
        disabled:state.pending,onClick:()=>{state.confirming=!state.confirming;state.selectedDuration=data.totalDays;paint();}},
        text(ctx,'Rejani qayta tuzish','Regenerate plan')):null);
    toolbar.append(buttons);
    const current=data.days[data.currentDay-1];
    const summary=h('div',{class:'sequence-metrics'},
      metric(text(ctx,'Jami kun','Days'),data.totalDays),
      metric(text(ctx,'Yakunlangan kun','Completed days'),data.completedDays),
      metric(text(ctx,'Joriy kun','Current day'),data.currentDay),
      metric(text(ctx,'Kunlik minimum ajratishingiz kerak bo‘lgan vaqt',
        'Minimum daily study time to allocate'),current.minutes+' min'));
    const confirm=state.confirming&&data.state==='active'?
      h('div',{class:'sequence-confirm',role:'group',
        'aria-label':text(ctx,'Rejani qayta tuzishni tasdiqlash','Confirm regeneration')},
        durationPicker(ctx,state.selectedDuration,days=>{state.selectedDuration=days;paint();},
          data.currentDay,state.pending),
        h('p',{},text(ctx,
          'Faqat kelajakdagi vazifalar almashtiriladi. Oldingi kunlar va joriy mashqlar saqlanadi.',
          'Only future tasks change. Completed days and the current day are preserved.')),
        h('div',{class:'sequence-controls'},
          h('button',{type:'button',class:'btn-secondary',disabled:state.pending,
            onClick:()=>{state.confirming=false;paint();}},text(ctx,'Bekor qilish','Cancel')),
          h('button',{type:'button',class:'btn-primary',disabled:state.pending,
            onClick:()=>void change('regenerate')},
            text(ctx,'Tasdiqlash','Confirm')))):null;
    panel.replaceChildren(...[
      toolbar,summary,confirm,
      data.state==='completed'?h('p',{role:'status',class:'sequence-notice'},
        text(ctx,data.totalDays+' kunlik reja yakunlandi.',data.totalDays+'-day plan completed.')):null,
      calendar(ctx,data,state),
      state.error?h('p',{role:'alert',class:'sequence-error'},state.error):null,
    ].filter(Boolean));
  }

  async function load() {
    if (state.pending || ctx.signal.aborted) return;
    state.pending=true;state.error=null;paint();
    try {
      const next=validateSequence(await api.request(SEQUENCE_API,{signal:ctx.signal,fresh:true}));
      if (ctx.signal.aborted) return;
      state.data=next;state.selectedDay=next.currentDay??null;
      if (next.state==='active' || next.state==='completed') state.selectedDuration=next.totalDays;
      state.confirming=false;
    } catch (error) {
      if (ctx.signal.aborted) return;
      state.error=text(ctx,'Rejani olishda xatolik yuz berdi. Qayta urining.',
        'The plan could not be loaded. Please retry.');
    } finally {
      state.pending=false;paint();
    }
  }

  async function change(type) {
    if (state.pending || ctx.signal.aborted) return;
    state.pending=true;state.error=null;paint();
    try {
      const options={method:'POST',signal:ctx.signal};
      options.body=type==='regenerate'?
        {confirmed:true,days:state.selectedDuration}:{days:state.selectedDuration};
      const next=validateSequence(await api.request(SEQUENCE_API+'/'+type,options));
      if (ctx.signal.aborted) return;
      state.data=next;state.selectedDay=next.currentDay??null;
      if (next.state==='active' || next.state==='completed') state.selectedDuration=next.totalDays;
      state.confirming=false;
    } catch (error) {
      if (ctx.signal.aborted) return;
      state.error=error?.code==='level_required'?
        text(ctx,'Darajani belgilang, so‘ng rejani yarating.',
          'Set your level before generating the plan.'):
        text(ctx,'Amal bajarilmadi. Qayta urinib ko‘ring.',
          'The action failed. Please retry.');
    } finally {
      state.pending=false;paint();
    }
  }

  paint();
  void load();
  if (ctx.url?.hash === '#study-plan-30') {
    const reveal = () => {
      if (!ctx.signal.aborted && panel.isConnected) panel.scrollIntoView?.({block:'start'});
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(reveal);
    else queueMicrotask(reveal);
  }
  const onVisibility = () => {if (!document.hidden) void load();};
  document.addEventListener('visibilitychange', onVisibility);
  ctx.signal.addEventListener('abort', () =>
    document.removeEventListener('visibilitychange', onVisibility), {once:true});
  ctx.onResume?.(() => void load());
  return {refresh:()=>void load()};
}

export function mountSequenceDashboard(ctx, root) {
  if (!['student','owner'].includes(ctx.session?.user?.role)) return;
  stylesheet();
  const panel=h('section',{class:'sequence-dashboard-card',
    'data-dashboard-30-plan':'','aria-label':text(ctx,'O‘quv rejasi','Learning plan')});
  root.append(panel);
  let generation=0;

  function draw(data,error) {
    if (ctx.signal.aborted) return;
    if (error) {
      panel.replaceChildren(h('h2',{},text(ctx,'O‘quv rejasi','Learning plan')),
        errorNotice(ctx,()=>void load()));
      return;
    }
    if (!data) {
      panel.replaceChildren(h('h2',{},text(ctx,'O‘quv rejasi','Learning plan')),
        h('p',{role:'status',class:'sequence-subtitle'},ctx.dict.common.loading));
      return;
    }
    const title=['active','completed'].includes(data.state)
      ? text(ctx,data.totalDays+' kunlik reja',data.totalDays+'-day plan')
      : text(ctx,'7 yoki 30 kunlik reja','7- or 30-day plan');
    const description=data.state==='level_required'?
      text(ctx,'Avval darajani belgilang','Set your level first'):
      data.state==='available'?
        text(ctx,'Reja yaratishga tayyor','Ready to create your plan'):
        data.state==='completed'?
          text(ctx,'Barcha '+data.totalDays+' kun bajarildi','All '+data.totalDays+' days complete'):
          text(ctx,'Kun ','Day ')+data.currentDay+' / '+data.totalDays;
    const progress=Number.isInteger(data.completedDays)?
      h('progress',{max:data.totalDays,value:data.completedDays,
        'aria-label':text(ctx,'Yakunlangan kunlar','Completed days')}):null;
    panel.replaceChildren(...[
      h('div',{class:'sequence-dashboard-heading'},
        h('div',{},h('h2',{},title),h('p',{class:'sequence-subtitle'},description)),
        h('span',{class:'sequence-dashboard-number','aria-hidden':'true'},
          data.state==='active'?String(data.currentDay):data.state==='completed'?String(data.totalDays):'—')),
      progress,
      h('a',{href:ASSIGNMENTS_PATH,class:'btn-secondary sequence-dashboard-link',
        'data-dashboard-plan-open':''},
        ['available','level_required'].includes(data.state)
          ? text(ctx,'Reja tuzish','Create plan')
          : text(ctx,'Rejani ochish','Open plan')),
    ].filter(Boolean));
  }
  async function load() {
    const ticket=++generation;
    draw(null,false);
    try {
      const data=validateSequence(await api.request(SEQUENCE_API,{signal:ctx.signal,fresh:true}));
      if (!ctx.signal.aborted && ticket===generation)draw(data,false);
    } catch {
      if (!ctx.signal.aborted && ticket===generation)draw(null,true);
    }
  }
  void load();
  ctx.onResume?.(()=>void load());
  return {refresh:()=>void load()};
}
