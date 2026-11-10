import {h} from '../../js/native.js';
import {asyncRegion, bandLine, button, card, dayTotals, detail, formatDay, heading, labelSkill, link,
  loadStyles, PATH, renderTasks, request, SKILLS, text, workspace} from './view.js';
import {shareControls} from './share.js';

function goalsForm(ctx, goals, onSave) {
  const band = (value, required = false) => h('input', {class:'input',type: 'number', min: 1, max: 9, step: .5,
    value: value ?? '', required});
  const target = band(goals.target, true);
  const minutes = h('input', {class:'input',type: 'number', min: 10, max: 300, value: goals.minutes, required: true});
  const exam = h('input', {class:'input',type: 'date', value: goals.examDate ?? ''});
  const preferred = h('input', {class:'input',type: 'time', value: goals.preferredTime ?? ''});
  const zone = h('input', {class:'input',type: 'text', maxLength: 64, required: true, value: goals.timezone});
  const week = Array.from({length: 7}, (_, i) => {
    const input = h('input', {type: 'checkbox', checked: goals.weekdays.includes(i)});
    return {input, label: h('label', {}, input, new Intl.DateTimeFormat(ctx.locale === 'uz' ? 'uz-UZ' : 'en', {weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,5+i))))};
  });
  const focus = SKILLS.map(skill => {
    const input = h('input', {type: 'checkbox', checked: goals.focusSkills.includes(skill)});
    return {skill, input, label: h('label', {}, input, labelSkill(skill))};
  });
  const skillTargets = SKILLS.map(skill => [skill, band(goals.skillTargets[skill])]);
  const notice = h('p', {role: 'alert', class: 'text-sm text-band-bad'});
  const save = h('button', {type: 'submit', class: 'btn-primary'}, text(ctx, 'Rejani saqlash', 'Save plan'));
  return h('form', {class: 'study-plan-form', onSubmit: async event => {
    event.preventDefault();
    const weekdays = week.flatMap(({input}, i) => input.checked ? [i] : []);
    if (!weekdays.length) {
      notice.textContent = text(ctx, 'Kamida bitta kunni tanlang.', 'Choose at least one study day.');
      return;
    }
    save.disabled = true;
    notice.textContent = '';
    try {
      const data = await request(ctx, '/preferences', {method: 'PUT', body: {
        target: target.valueAsNumber, examDate: exam.value || null, minutes: minutes.valueAsNumber,
        preferredTime: preferred.value || null, timezone: zone.value.trim(), weekdays,
        focusSkills: focus.filter(x => x.input.checked).map(x => x.skill),
        skillTargets: Object.fromEntries(skillTargets.filter(([, input]) => input.value).map(([skill, input]) => [skill, input.valueAsNumber])),
      }});
      if (!ctx.signal.aborted) onSave(data);
    } catch (error) {
      if (!ctx.signal.aborted) notice.textContent = error.status === 400 ?
        text(ctx, 'Band, sana va vaqt mintaqasini tekshiring.', 'Check the band, exam date and timezone.') : ctx.dict.errors.unknown;
    } finally {save.disabled = false;}
  }},
  h('div', {class: 'study-plan-grid'},
    h('label', {}, text(ctx, 'IELTS maqsad bandi', 'Target IELTS band'), target),
    h('label', {}, text(ctx, 'Kunlik vaqt (daqiqa)', 'Daily time (minutes)'), minutes),
    h('label', {}, text(ctx, 'IELTS imtihon sanasi', 'Exam date'), exam),
    h('label', {}, text(ctx, 'O‘qish vaqti', 'Preferred study time'), preferred),
    h('label', {}, text(ctx, 'Vaqt mintaqasi (IANA)', 'Timezone (IANA)'), zone)),
  h('fieldset', {}, h('legend', {}, text(ctx, 'O‘qish kunlari', 'Study days')), week.map(day => day.label)),
  h('fieldset', {}, h('legend', {}, text(ctx, 'Ustuvor ko‘nikmalar', 'Priority skills')), focus.map(item => item.label)),
  h('div', {}, detail(text(ctx, 'Ko‘nikmalar bo‘yicha maqsadlar (ixtiyoriy)', 'Skill targets (optional)')),
    h('div', {class: 'study-plan-metrics'}, skillTargets.map(([skill, input]) => h('label', {}, labelSkill(skill), input)))),
  notice, h('div', {class: 'study-plan-actions'}, save));
}

function summary(ctx, data) {
  const goals = data.goals;
  const forecast = data.forecast;
  const confidence = forecast && ({
    low: text(ctx, 'Ishonch past', 'Low confidence'), medium: text(ctx, 'Ishonch o‘rtacha', 'Medium confidence'),
    observed: text(ctx, 'Maqsadga mos band qayd etilgan', 'Target band observed'),
  })[forecast.confidence];
  return card(heading(text(ctx, 'Maqsad va baholash', 'Goal and assessment')), bandLine(ctx, data),
    data.latest?.overall ? null : detail(text(ctx, 'Umumiy band uchun baholashlar yetarli emas.', 'More assessments are needed for an overall band.')),
    h('div', {class: 'study-plan-metrics'}, SKILLS.map(skill =>
      h('div', {class: 'study-plan-metric'}, detail(labelSkill(skill)),
        h('strong', {}, (data.latest?.[skill]?.band?.toFixed(1) ?? '—') + ' → ' + (goals.skillTargets[skill]?.toFixed(1) ?? goals.target?.toFixed(1) ?? '—'))))),
    detail(goals.examDate ? text(ctx, 'Imtihon', 'Exam') + ' · ' + formatDay(ctx, goals.examDate, true) : text(ctx, 'Imtihon sanasi belgilanmagan.', 'Exam date is unset.')),
    goals.preferredTime ? detail(text(ctx, 'O‘qish vaqti', 'Preferred time') + ' · ' + goals.preferredTime + ' (' + goals.timezone + ')') : null,
    detail(forecast ? formatDay(ctx, forecast.from) + ' – ' + formatDay(ctx, forecast.through) + ' · ' + confidence :
      text(ctx, 'Prognoz uchun ko‘proq baholash topshiring.', 'Complete more assessments to estimate readiness.')),
    forecast && goals.examDate && forecast.through > goals.examDate ? detail(text(ctx, 'Taxminiy oraliq imtihon sanasidan keyinga cho‘ziladi.', 'The estimated interval extends beyond the exam date.')) : null);
}

function analytics(ctx, data) {
  const history = [...(data.history ?? [])].reverse();
  const filter = h('select', {class:'input','aria-label': text(ctx, 'Davr', 'Period')},
    h('option', {value: '30'}, text(ctx, '30 kun', '30 days')),
    h('option', {value: '90'}, text(ctx, '90 kun', '90 days')),
    h('option', {value: '180', selected: true}, text(ctx, '180 kun', '180 days')));
  const skills = h('select', {class:'input','aria-label': text(ctx, 'Ko‘nikma', 'Skill')},
    h('option', {value: ''}, text(ctx, 'Hammasi', 'All skills')),
    [...SKILLS, 'overall'].map(skill => h('option', {value: skill}, labelSkill(skill))));
  const rows = h('div', {class: 'study-plan-timeline'});
  function draw() {
    const cutoff = Date.parse(data.today) - Number(filter.value) * 86400000;
    const selected = history.filter(row => Date.parse(row.day) >= cutoff && (!skills.value || row.skill === skills.value));
    rows.replaceChildren(...(selected.length ? selected.map(row => h('div', {class: 'study-plan-metric'},
      detail(formatDay(ctx, row.day) + ' · ' + labelSkill(row.skill)),
      h('meter', {min: 0, max: 9, value: row.band, 'aria-label': labelSkill(row.skill)}), ' ', row.band.toFixed(1))) :
      [detail(text(ctx, 'Bu davrda baholangan natijalar yo‘q.', 'No graded results in this period.'))]));
  }
  filter.addEventListener('change', draw);
  skills.addEventListener('change', draw);
  draw();
  return card(heading(text(ctx, 'Baholash tarixi', 'Assessment history')), h('div', {class: 'study-plan-actions'}, filter, skills), rows);
}

function weaknesses(ctx, data) {
  const statuses = {open: ['E’tibor kerak', 'Needs attention'], improving: ['Yaxshilanmoqda', 'Improving'], resolved: ['Yaxshilangan', 'Resolved']};
  const rows = data.weaknesses ?? [];
  return card(heading(text(ctx, 'Zaif tomonlar', 'Weaknesses')),
    rows.length ? rows.map(row => h('details', {},
      h('summary', {}, row.label + ' · ' + text(ctx, ...(statuses[row.status] ?? statuses.open))),
      detail(labelSkill(row.area) + ' · ' + row.occurrenceCount + ' ' + text(ctx, 'qayd', 'observations')),
      row.lastSeenAt ? detail(formatDay(ctx, row.lastSeenAt.slice(0, 10))) : null,
      row.history?.map(item => detail(formatDay(ctx, item.at.slice(0, 10)) + ' · ' + item.correct + '/' + item.total)),
      row.href ? link(text(ctx, 'Tavsiya', 'Recommended practice'), row.href) : null)) :
      detail(text(ctx, 'Hozircha aniqlangan zaif tomonlar yo‘q.', 'No weaknesses identified yet.')));
}

function vocabulary(ctx, data) {
  const v = data.vocabulary;
  if (!v) return null;
  return card(heading(text(ctx, 'Lug‘at o‘zlashtirish', 'Vocabulary mastery')),
    detail(v.total + ' ' + text(ctx, 'saqlangan', 'saved') + ' · ' + v.due + ' ' + text(ctx, 'takrorlash kerak', 'due')),
    h('div', {class: 'study-plan-metrics'}, Object.entries(v.mastery).map(([state, count]) =>
      h('div', {class: 'study-plan-metric'}, detail(labelSkill(state)), h('strong', {}, count)))),
    detail(text(ctx, '7 kunlik eslash aniqligi', '7-day recall accuracy') + ' · ' + (v.recall === null ? '—' : v.recall + '%')),
    v.reviews.map(day => detail(formatDay(ctx, day.day) + ' · ' + day.correct + '/' + day.count)),
    link(text(ctx, 'Lug‘atni takrorlash', 'Review vocabulary'), '/app/vocabulary?tab=revision'));
}

export function mount(ctx) {
  const {content: body} = workspace(ctx, text(ctx, 'Shaxsiy o‘quv reja', 'Personal study plan'),
    text(ctx, 'IELTS maqsadingizga mos mashqlar.', 'Practice for your IELTS goal.'));
  if (ctx.session?.user?.role !== 'student') {
    body.append(detail(text(ctx, 'O‘quv reja o‘quvchi hisobida ochiladi.', 'Study plans are available to learners.')));
    return;
  }
  const content = h('div',{class:'study-plan-content'});
  const month = h('div',{class:'study-plan-content',hidden:true});
  let monthly = false;
  let monthlyLoaded = false;
  let chosen;
  const selectWeek = () => {
    monthly = false;
    month.hidden = true;
    content.hidden = false;
    setButtons();
  };
  const selectMonth = async () => {
    monthly = true;
    content.hidden = true;
    month.hidden = false;
    setButtons();
    if (monthlyLoaded) return;
    month.replaceChildren(detail(ctx.dict.common.loading));
    try {
      const {mountMonthly} = await import('./monthly.js');
      if (ctx.signal.aborted || monthlyLoaded) return;
      monthlyLoaded = true;
      mountMonthly(ctx,month,selectWeek);
    } catch {
      if (!ctx.signal.aborted) month.replaceChildren(detail(ctx.dict.errors.unknown));
    }
  };
  const weeklyButton = button(text(ctx,'7 kunlik reja','7-day plan'),selectWeek);
  const monthlyButton = button(text(ctx,'30 kunlik reja','30-day plan'),()=>void selectMonth());
  function setButtons() {
    for (const [control,selected] of [[weeklyButton,!monthly],[monthlyButton,monthly]]) {
      control.className = selected?'btn-primary':'btn-secondary';
      control.setAttribute('aria-pressed',String(selected));
    }
  }
  setButtons();
  body.append(h('div',{class:'study-plan-actions',role:'group','aria-label':text(ctx,'Reja muddati','Plan length')},
    weeklyButton,monthlyButton),content,month);

  function draw(data) {
    const goals = data.goals;
    if (month.dataset.setup === 'true' && goals.configured) {monthlyLoaded=false;delete month.dataset.setup;}
    if (!goals.configured) {
      content.replaceChildren(card(heading(text(ctx, 'Maqsadni belgilang', 'Set your goal')), goalsForm(ctx, goals, draw)));
      return;
    }
    chosen = data.days.some(day => day.date === chosen) ? chosen : data.today;
    const active = h('div', {class: 'flex flex-col gap-3'});
    const days = h('div', {class: 'study-plan-days', role: 'group', 'aria-label': text(ctx, 'Haftalik kalendar', 'Weekly calendar')});
    const weekly = data.days.map(dayTotals).reduce((a, b) => ({planned:a.planned+b.planned, completed:a.completed+b.completed}),
      {planned:0,completed:0});
    function drawDay() {
      const day = data.days.find(entry => entry.date === chosen);
      for (const control of days.children) {
        const selected = control.dataset.day === chosen;
        control.setAttribute('aria-pressed', String(selected));
        control.classList.toggle('btn-primary', selected);
        control.classList.toggle('btn-secondary', !selected);
      }
      const counts = dayTotals(day);
      const notice = h('p', {role:'alert', class:'text-sm text-band-bad'});
      function reschedule(task) {
        const select = h('select', {class:'input','aria-label': text(ctx, 'Yangi sana', 'New date')},
          data.days.map(entry => h('option', {value:entry.date, selected:entry.date === task.date}, formatDay(ctx, entry.date))));
        return h('details', {}, h('summary', {}, text(ctx, 'Ko‘chirish', 'Reschedule')),
          h('div', {class:'study-plan-actions'}, select, button(text(ctx, 'Saqlash', 'Save'), async event => {
            const control = event.currentTarget;
            control.disabled = true;
            try {
              const next = await request(ctx, '/reschedule', {method:'PUT', body:{key:task.key, date:select.value}});
              if (!ctx.signal.aborted) draw(next);
            } catch (error) {
              if (!ctx.signal.aborted) notice.textContent = error.status === 409 ?
                text(ctx, 'Tanlangan kunda bo‘sh vaqt yo‘q yoki u dam olish kuni.', 'This day is at capacity or unavailable.') : ctx.dict.errors.unknown;
            } finally {control.disabled = false;}
          })));
      }
      active.replaceChildren(heading(formatDay(ctx, chosen, true)),
        detail(counts.completed + '/' + counts.planned + ' · ' + counts.completedMinutes + '/' + counts.minutes + ' ' + text(ctx, 'daq.', 'min')),
        renderTasks(ctx, day.tasks, reschedule), notice);
    }
    for (const day of data.days) {
      const counts = dayTotals(day);
      days.append(button([formatDay(ctx, day.date), detail(counts.completed + '/' + counts.planned + ' · ' + counts.minutes)],
        () => {chosen = day.date; drawDay();}, {class:'btn-secondary study-plan-day', 'data-day':day.date}));
    }
    drawDay();
    const share = shareControls(ctx, data);
    content.replaceChildren(
      h('div', {class:'study-plan-grid'}, summary(ctx, data),
        card(heading(text(ctx, 'Haftalik bajarilish', 'Weekly completion')),
          detail(weekly.completed + '/' + weekly.planned),
          weekly.planned ? h('progress', {class:'study-plan-progress', max:weekly.planned, value:weekly.completed,
            'aria-label':text(ctx, 'Haftalik bajarilish', 'Weekly completion')}) : null,
          detail(data.streak + ' ' + text(ctx, 'kun ketma-ket o‘qish', 'day study streak')),
          data.dailyStar ? h('span',{class:'badge'},text(ctx,'Kunlik yulduz','Daily star')) : null,
          h('details', {}, h('summary', {}, text(ctx, 'Maqsad va sozlamalarni tahrirlash', 'Edit goal and preferences')), goalsForm(ctx, goals, draw)))),
      card(heading(text(ctx, '7 kunlik kalendar', '7-day calendar')), days, active),
      data.backlog?.length ? card(heading(text(ctx, 'Joylashtirilmagan vazifalar', 'Unscheduled work')),
        data.backlog.map(item => item.href ? link(item.title, item.href) : detail(item.title + ' · ' + item.minutes))) : null,
      data.pastTasks?.length ? card(h('details', {}, h('summary', {}, text(ctx, 'Avvalgi vazifalar', 'Previous tasks')),
        renderTasks(ctx, data.pastTasks))) : null,
      h('div', {class:'study-plan-grid'}, analytics(ctx, data), weaknesses(ctx, data)),
      vocabulary(ctx, data), share);
  }
  const load = asyncRegion(ctx, content, () => request(ctx), draw);
  void load();
  ctx.onResume?.(() => void load({background:true}));
}

export function mountLearningOverview(ctx, host) {
  loadStyles();
  const refresh = asyncRegion(ctx, host, () => request(ctx,'?view=progress'), data => {
    host.replaceChildren(
      card(heading(text(ctx,'IELTS maqsadi','IELTS goal')),bandLine(ctx,data),
        link(text(ctx,'O‘quv rejasini ochish','Open study plan'),PATH)),
      h('div',{class:'study-plan-grid'},analytics(ctx,data),weaknesses(ctx,data)),
      vocabulary(ctx,data));
  });
  void refresh();
  ctx.onResume?.(() => void refresh({background:true}));
}
