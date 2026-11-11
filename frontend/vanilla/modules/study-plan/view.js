import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {BackLink} from '../shared/presentation.js';

export const BASE = '/api/study-plan';
export const PATH = '/app/study-plan';
export const SKILLS = ['listening', 'reading', 'writing', 'speaking'];
export const text = (ctx, uz, en) => ctx.locale === 'uz' ? uz : en;
export const card = (...children) => h('section', {class: 'card flex min-w-0 flex-col gap-3 p-4 sm:p-5'}, children);
export const link = (label, href, className = 'btn-secondary') => h('a', {href, class: className}, label);
export const button = (label, onClick, props = {}) => h('button', {type: 'button', class: 'btn-secondary', onClick, ...props}, label);
export const heading = label => h('h2', {class: 'font-display text-xl text-ink-900'}, label);
export const detail = value => h('p', {class: 'text-sm text-ink-500'}, value);
export const labelSkill = skill => skill ? skill[0].toUpperCase() + skill.slice(1) : '';
export const request = (ctx, path = '', options = {}) => api.request(BASE + path, {signal: ctx.signal, ...options});

export function formatDay(ctx, day, long = false) {
  return new Intl.DateTimeFormat(ctx.locale === 'uz' ? 'uz-UZ' : 'en', {
    timeZone: 'UTC', ...(long ? {weekday: 'long'} : {weekday: 'short'}), month: 'short', day: 'numeric',
  }).format(new Date(day + 'T12:00:00Z'));
}

export function labelReason(ctx, reason) {
  if (reason.startsWith('coach:')) return reason.slice(6);
  if (reason.startsWith('reading:')) return text(ctx, 'So‘nggi urinishlarda qiyinchilik kuzatildi — ', 'Recent attempts show difficulty with ') +
    reason.slice(8).replaceAll('_', ' ');
  const labels = {
    diagnostic: ['Darajani baholash va mashq qilish', 'Assess and practise this skill'],
    foundation: ['Asosiy ko‘nikmalarni rivojlantirish', 'Build foundational skills'],
    assignment: ['O‘qituvchi vazifasi', 'Teacher assignment'],
    assignment_overdue: ['O‘qituvchi vazifasining muddati o‘tgan', 'Teacher assignment past its deadline'],
    scheduled_mock: ['Haftalik sinov oynasi', 'Weekly assessment window'],
    vocab_due: ['Takrorlash muddati kelgan so‘zlar', 'Words due for review'],
  };
  return labels[reason] ? text(ctx, ...labels[reason]) : reason;
}

export function dayTotals(day) {
  const tasks = day?.tasks ?? [];
  const completed = tasks.filter(task => task.status === 'completed');
  return {planned: tasks.length, completed: completed.length,
    minutes: tasks.reduce((sum, task) => sum + task.minutes, 0),
    completedMinutes: completed.reduce((sum, task) => sum + task.minutes, 0)};
}

export function renderTasks(ctx, tasks, reschedule) {
  if (!tasks?.length) return detail(text(ctx, 'Bu kunga vazifa rejalashtirilmagan.', 'Nothing is scheduled for this day.'));
  return h('ul', {class: 'study-plan-tasks'}, tasks.map(task =>
    h('li', {class: 'study-plan-task', 'data-study-task': task.key, 'data-study-task-status': task.status},
      h('div', {class: 'study-plan-task-description'},
        h('strong', {}, task.title),
        detail(labelSkill(task.skill) + ' · ' + task.minutes + ' ' + text(ctx, 'daq.', 'min')),
        detail(labelReason(ctx, task.reason)),
        task.rescheduled ? detail(text(ctx, 'Avvalgi sana', 'Original date') + ' · ' + formatDay(ctx, task.originalDate)) : null),
      h('div', {class: 'study-plan-actions'},
        task.status === 'completed' ? h('span', {class: 'badge'}, text(ctx, 'Bajarildi', 'Completed')) :
          task.href ? link(task.status === 'in_progress' ? text(ctx, 'Davom etish', 'Continue') :
            text(ctx, 'Boshlash', 'Start'), task.href, 'btn-primary') :
            h('span', {class: 'badge'}, text(ctx, 'Hozir ochilmaydi', 'Unavailable')),
        reschedule && task.href && !['mock', 'vocabulary'].includes(task.skill) && !task.reason.startsWith('assignment')
          ? reschedule(task) : null))));
}

export function loadStyles() {
  if (!document.querySelector('[data-study-plan-css]')) {
    document.head.append(h('link', {rel: 'stylesheet', href: '/modules/study-plan/style.css', 'data-study-plan-css': ''}));
  }
}

export function workspace(ctx, title, subtitle) {
  loadStyles();
  const host = h('div', {class: 'study-plan-page', 'data-route-usable': 'study-plan'});
  const content = h('div', {class: 'study-plan-content'});
  host.append(BackLink({fallbackHref: ctx.url.pathname === PATH ? '/app/dashboard' : PATH, label: ctx.dict.common.back}),
    h('header', {class: 'flex flex-col gap-2'},
      h('h1', {class: 'font-display text-3xl text-ink-900'}, title), detail(subtitle)),
    h('nav', {class: 'study-plan-actions', 'aria-label': title},
      link(text(ctx, 'Haftalik reja', 'Weekly plan'), PATH),
      link(text(ctx, 'Reyting', 'Leaderboard'), '/app/leaderboard'),
      link(text(ctx, 'Mukofotlar', 'Rewards'), PATH + '/rewards')),
    content);
  ctx.root.append(host);
  return {host, content};
}

export function asyncRegion(ctx, host, loader, ready) {
  let generation = 0;
  return async function load({background = false} = {}) {
    const ticket = ++generation;
    if (!background) host.replaceChildren(h('p', {role: 'status'}, ctx.dict.common.loading));
    try {
      const data = await loader();
      if (!ctx.signal.aborted && ticket === generation) ready(data);
    } catch {
      if (!ctx.signal.aborted && ticket === generation) host.replaceChildren(h('div', {role: 'alert'},
        detail(ctx.dict.errors.unknown), button(ctx.dict.errorPage.retry, () => void load())));
    }
  };
}

export function bandLine(ctx, data) {
  const current = data.latest?.overall?.band;
  const target = data.goals.target;
  const format = value => value?.toFixed(1) ?? '—';
  return h('div', {class: 'study-plan-band'},
    h('div', {}, detail(text(ctx, 'Taxminiy band', 'Estimated band')), h('strong', {}, format(current))),
    h('span', {'aria-hidden': 'true'}, '→'),
    h('div', {}, detail(text(ctx, 'Maqsad', 'Target')), h('strong', {}, format(target))));
}

export function mountToday(ctx, host) {
  loadStyles();
  const body = h('div', {class: 'flex flex-col gap-3'});
  host.append(card(heading(text(ctx, 'Bugungi reja', "Today's plan")), body));
  const refresh = asyncRegion(ctx, body, () => request(ctx, '?view=today'), data => {
    const day = data.days[0];
    const counts = dayTotals(day);
    body.replaceChildren(bandLine(ctx, data),
      day ? detail(formatDay(ctx, day.date, true) + ' · ' + counts.completed + '/' + counts.planned + ' ' + text(ctx, 'bajarildi', 'completed')) :
        detail(text(ctx, 'Haftalik maqsadingizni belgilang.', 'Set your weekly study goal.')),
      counts.planned ? h('progress', {class: 'study-plan-progress', max: counts.planned, value: counts.completed,
        'aria-label': text(ctx, 'Bugungi vazifalar', 'Daily task progress')}) : null,
      data.dailyStar ? h('span',{class:'badge'},text(ctx,'Kunlik yulduz','Daily star')) : null,
      day ? renderTasks(ctx, day.tasks.slice(0, 4)) : null,
      h('div', {class: 'study-plan-actions'}, link(text(ctx, 'O‘quv rejasini ochish', 'Open study plan'), PATH)));
  });
  void refresh();
  ctx.onResume?.(() => void refresh({background: true}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && host.isConnected) void refresh({background:true});
  }, {signal:ctx.signal});
}
