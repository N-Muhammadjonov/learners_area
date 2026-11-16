import {api} from '../../js/api-client.js';
import {academyHelp} from '../shared/academy-help.js';
import {paymentDate} from '../payments/format.js';
import {el, listen} from '../../js/dom.js';
import {BackLink} from './kit.js';
import {attendanceRoster, attendanceSummary} from './academy-attendance.js';

const PATH = '/app/management/groups';
const API = '/api/staff/academy';
const MANAGERS = ['owner', 'admin'];
const GROUP_STATES = ['active', 'paused', 'completed', 'archived'];
const NEXT_STATUS = {
 pending: ['active', 'withdrawn'],
 active: ['paused', 'completed', 'withdrawn'],
 paused: ['active', 'completed', 'withdrawn'],
};
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const en = {
 heading: 'Academy groups', create: 'Create group', edit: 'Edit group', search: 'Search',
 filters: 'All statuses', name: 'Group name', branch: 'Branch', room: 'Room',
 fee: 'Fee plan label', capacity: 'Capacity', start: 'Start date', end: 'End date', status: 'Status',
 course: 'Course', teachers: 'Teachers', selectCourse: 'Select a course', choose: 'Select',
 add: 'Add', remove: 'Remove', enroll: 'Enroll student', student: 'Student', transfer: 'Transfer',
 transferTo: 'Destination group', groupSearch: 'Search group, branch or course',
 memberSearch: 'Search student names', noGroups: 'No matching groups.', noStudents: 'No matching students.',
 noOptions: 'No matching results.', history: 'Group history', roster: 'Group roster',
 occupancy: 'Seats reserved', saved: 'Saved', previous: 'Previous', next: 'Next',
 active: 'Active', paused: 'Paused', completed: 'Completed', archived: 'Archived',
 pending: 'Pending', withdrawn: 'Withdrawn', transferred: 'Transferred',
 group_full: 'All seats are reserved.', student_has_current_group: 'This student already belongs to a group for this course.',
 group_not_accepting: 'This group is closed for enrollment.', group_revision_conflict: 'This group changed. Reload it before editing.',
 membership_revision_conflict: 'This membership changed. Reload the roster and try again.',
 group_has_members: 'Close or transfer current memberships before completing or archiving the group.',
 capacity_below_occupied: 'Capacity cannot be lower than the number of reserved seats.',
 invalid_teachers: 'Select at least one active teacher.', invalid_input: 'Check the form and try again.',
 invalid_group_transition: 'This group cannot change to that status.',
 schedule_overlap: 'This room, group or teacher is already booked at that time.',
 invalid_session_window: 'Choose a date within the active group dates and scheduling horizon.',
 session_revision_conflict: 'This session changed. Reload the timetable before editing.',
 session_not_ended: 'This session has not ended yet.',
};
const uz = {
 heading: 'Akademiya guruhlari', create: 'Guruh yaratish', edit: 'Guruhni tahrirlash', search: 'Qidirish',
 filters: 'Barcha holatlar', name: 'Guruh nomi', branch: 'Filial', room: 'Xona',
 fee: 'To‘lov rejasi nomi', capacity: 'Sig‘im', start: 'Boshlanish sanasi', end: 'Tugash sanasi', status: 'Holat',
 course: 'Kurs', teachers: 'O‘qituvchilar', selectCourse: 'Kursni tanlang', choose: 'Tanlang',
 add: 'Qo‘shish', remove: 'Olib tashlash', enroll: 'O‘quvchini yozish', student: 'O‘quvchi', transfer: 'Ko‘chirish',
 transferTo: 'Qabul qiluvchi guruh', groupSearch: 'Guruh, filial yoki kurs bo‘yicha qidiring',
 memberSearch: 'O‘quvchi ismi bo‘yicha qidiring', noGroups: 'Mos guruh topilmadi.', noStudents: 'Mos o‘quvchi topilmadi.',
 noOptions: 'Mos natija topilmadi.', history: 'Guruh tarixi', roster: 'Guruh ro‘yxati',
 occupancy: 'Band joylar', saved: 'Saqlandi', previous: 'Oldingi', next: 'Keyingi',
 active: 'Faol', paused: 'Pauzada', completed: 'Yakunlangan', archived: 'Arxivlangan',
 pending: 'Kutilmoqda', withdrawn: 'Chiqdi', transferred: 'Ko‘chirildi',
 group_full: 'Guruhdagi barcha joylar band.', student_has_current_group: 'O‘quvchi bu kursdagi guruhlardan biriga yozilgan.',
 group_not_accepting: 'Bu guruh hozir o‘quvchi qabul qilmaydi.', group_revision_conflict: 'Guruh ma’lumotlari o‘zgargan. Sahifani yangilab ko‘ring.',
 membership_revision_conflict: 'A’zolik o‘zgargan. Ro‘yxatni yangilab qayta urining.',
 group_has_members: 'Guruhni yakunlash yoki arxivlashdan oldin amaldagi a’zoliklarni yoping yoki ko‘chiring.',
 capacity_below_occupied: 'Sig‘im band joylar sonidan kam bo‘la olmaydi.',
 invalid_teachers: 'Kamida bitta faol o‘qituvchini tanlang.', invalid_input: 'Maydonlarni tekshirib, qayta urining.',
 invalid_group_transition: 'Guruhni bu holatga o‘tkazib bo‘lmaydi.',
 schedule_overlap: 'Xona, guruh yoki o‘qituvchi shu vaqtda band.',
 invalid_session_window: 'Guruh faol bo‘lgan oraliqdagi ruxsat etilgan sanani tanlang.',
 session_revision_conflict: 'Dars o‘zgargan. Tahrirlashdan oldin jadvalni yangilang.',
 session_not_ended: 'Bu dars hali tugamagan.',
};

const words = ctx => ctx.locale === 'uz' ? uz : en;
const button = (label, attrs = {}) => el('button', {type: 'button', class: 'btn-secondary', ...attrs}, label);
const option = (value, label) => el('option', {value}, label);
const field = (label, input) => el('label', {class: 'flex min-w-0 flex-col gap-1 text-sm'}, label, input);
const replace = (node, ...children) => node.replaceChildren(...children.filter(Boolean));
const title = text => el('h2', {class: 'font-display text-xl'}, text);
const errorText = (ctx, error) => Object.hasOwn(words(ctx), error?.code) ? words(ctx)[error.code] : ctx.dict.common.error;
const request = (ctx, path, options = {}) => api.request(API + path, {...options, signal: ctx.signal});

function paged(ctx, page, hasNext, link) {
 const t = words(ctx);
 return el('nav', {class: 'flex items-center gap-3', 'aria-label': t.heading},
  page > 1 ? el('a', {href: link(page - 1), class: 'btn-secondary'}, t.previous) : null,
  el('span', {}, String(page)),
  hasNext ? el('a', {href: link(page + 1), class: 'btn-secondary'}, t.next) : null);
}

function searchBar(ctx, label, query, status, callback, branch = '') {
 const t = words(ctx);
 const input = el('input', {class: 'input', type: 'search', maxlength: 120, value: query});
 const selector = status === null ? null : el('select', {class: 'input'}, option('', t.filters),
  GROUP_STATES.map(value => option(value, t[value])));
 if (selector) selector.value = status;
 const branchInput = selector ? el('input', {class: 'input', type: 'search', maxlength: 120,
  value: branch, 'data-academy-branch-filter': ''}) : null;
 const form = el('form', {class: 'flex flex-wrap items-end gap-3'}, field(label, input),
  selector ? field(t.status, selector) : null,
  branchInput ? field(t.branch, branchInput) : null, button(t.search, {type: 'submit'}));
 listen(form, 'submit', event => {
  event.preventDefault();
  callback(input.value.trim(), selector?.value ?? '', branchInput?.value.trim() ?? '');
 }, ctx.signal);
 return form;
}

export function academyLookup(ctx, label, find, multiple = false, initial = []) {
 const t = words(ctx);
 const picked = new Map(initial.map(item => [item.id, item.label]));
 const input = el('input', {class: 'input', type: 'search', maxlength: 120});
 const results = el('select', {class: 'input', 'aria-label': label});
 const go = button(t.search);
 const choose = button(multiple ? t.add : t.choose, {disabled: true});
 const selected = el('ul', {class: 'space-y-1'});
 const status = el('p', {role: 'status', class: 'text-sm'});
 let found = [];
 function paint() {
  selected.replaceChildren(...[...picked].map(([id, name]) => {
   const remove = button(t.remove, {'aria-label': name + ' · ' + t.remove});
   remove.addEventListener('click', () => {
    picked.delete(id);
    paint();
   });
   return el('li', {class: 'flex flex-wrap items-center gap-2'}, name, remove);
  }));
 }
 async function load() {
  if (go.disabled || ctx.signal.aborted) return;
  go.disabled = true;
  choose.disabled = true;
  status.textContent = ctx.dict.common.loading;
  try {
   found = await find(input.value.trim());
   if (ctx.signal.aborted) return;
   results.replaceChildren(...found.map(item => option(item.id, item.label)));
   choose.disabled = found.length === 0;
   status.textContent = found.length ? '' : t.noOptions;
  } catch (error) {
   if (!ctx.signal.aborted) status.textContent = errorText(ctx, error);
  } finally { go.disabled = false; }
 }
 listen(go, 'click', load, ctx.signal);
 listen(input, 'keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); void load(); }
 }, ctx.signal);
 listen(choose, 'click', () => {
  const item = found.find(row => row.id === results.value);
  if (!item) return;
  if (!multiple) picked.clear();
  if (picked.size < 12) picked.set(item.id, item.label);
  paint();
 }, ctx.signal);
 paint();
 return {node: el('fieldset', {class: 'space-y-2'}, el('legend', {class: 'font-medium'}, label),
   el('div', {class: 'flex flex-wrap items-end gap-2'}, field(label, input), go, results, choose),
   status, selected), ids: () => [...picked.keys()]};
}

function options(ctx, kind, label, multiple, initial) {
 return academyLookup(ctx, label, async query =>
  (await request(ctx, '/lookups/' + kind + '?' + new URLSearchParams({q: query}))).options,
 multiple, initial);
}

function submit(ctx, form, caption, handler, {reload = false} = {}) {
 const t = words(ctx), save = button(caption, {type: 'submit', class: 'btn-primary'});
 const failure = el('p', {role: 'alert', hidden: true, class: 'text-sm text-band-bad'});
 const success = el('p', {role: 'status', class: 'text-sm'});
 form.append(save, failure, success);
 listen(form, 'submit', async event => {
  event.preventDefault();
  if (save.disabled || ctx.signal.aborted || !form.reportValidity()) return;
  save.disabled = true;
  save.textContent = ctx.dict.common.saving;
  failure.hidden = true;
  success.textContent = '';
  try {
   await handler();
   if (!ctx.signal.aborted) {
    success.textContent = t.saved;
    if (reload) await ctx.refresh();
   }
  } catch (error) {
   if (!ctx.signal.aborted) {
    failure.textContent = errorText(ctx, error);
    failure.hidden = false;
   }
  } finally {
   save.disabled = false;
   save.textContent = caption;
  }
 }, ctx.signal);
 return form;
}

function groupForm(ctx, data) {
 const t = words(ctx), existing = data?.group;
 const id = existing?.id ?? crypto.randomUUID();
 const course = existing ? null : options(ctx, 'courses', t.course);
 const teachers = options(ctx, 'teacher', t.teachers, true,
  data?.teachers.map(item => ({...item, label: item.name || item.id})) ?? []);
 const name = el('input', {class: 'input', required: true, maxlength: 120, value: existing?.name});
 const branch = el('input', {class: 'input', required: true, maxlength: 120, value: existing?.branch});
 const room = el('input', {class: 'input', maxlength: 120, value: existing?.room});
 const fee = el('input', {class: 'input', maxlength: 120, value: existing?.fee_plan_label});
 const capacity = el('input', {class: 'input', type: 'number', min: 1, max: 1000, required: true, value: existing?.capacity});
 const start = el('input', {class: 'input', type: 'date', required: true, value: existing?.starts_on});
 const end = el('input', {class: 'input', type: 'date', value: existing?.ends_on});
 const states = existing ? GROUP_STATES : ['active', 'paused'];
 const status = el('select', {class: 'input'}, states.map(value => option(value, t[value])));
 status.value = existing?.status ?? 'active';
 const form = el('form', {class: 'card space-y-4 p-4', 'data-academy-group-form': ''},
  title(existing ? t.edit : t.create), course?.node, teachers.node,
  el('div', {class: 'grid gap-3 sm:grid-cols-2'},
   field(t.name, name), field(t.branch, branch), field(t.room, room), field(t.fee, fee),
   field(t.capacity, capacity), field(t.start, start), field(t.end, end), field(t.status, status)));
 return submit(ctx, form, ctx.dict.common.save, async () => {
  const teacherIds = teachers.ids(), courseId = course?.ids()[0];
  if (!teacherIds.length) throw {code: 'invalid_teachers'};
  if (!existing && !courseId) throw {code: 'invalid_input'};
  const body = {name: name.value.trim(), branch: branch.value.trim(), room: room.value.trim() || null,
   feePlanLabel: fee.value.trim() || null, capacity: capacity.valueAsNumber,
   startsOn: start.value, endsOn: end.value || null, status: status.value, teacherIds,
   ...(existing ? {revision: existing.revision} : {id, courseId})};
  if (existing) {
   await request(ctx, '/groups/' + id, {method: 'PUT', body});
  } else {
   await request(ctx, '/groups', {method: 'POST', body});
   await ctx.navigate(PATH + '?group=' + encodeURIComponent(id));
  }
 }, {reload: Boolean(existing)});
}

function enrolForm(ctx, group) {
 const t = words(ctx), person = options(ctx, 'student', t.student);
 const status = el('select', {class: 'input'}, option('active', t.active), option('pending', t.pending));
 const form = el('form', {class: 'card space-y-3 p-4'}, title(t.enroll), person.node, field(t.status, status));
 return submit(ctx, form, t.enroll, () => {
  const [studentId] = person.ids();
  if (!studentId) throw {code: 'invalid_input'};
  return request(ctx, '/groups/' + group.id + '/memberships', {method: 'POST', body: {studentId, status: status.value}});
 }, {reload: true});
}

function memberActions(ctx, group, member) {
 const t = words(ctx), endpoint = '/groups/' + group.id + '/memberships/' + member.id;
 const states = NEXT_STATUS[member.status];
 if (!states) return null;
 const status = el('select', {class: 'input'}, states.map(value => option(value, t[value])));
 const statusForm = submit(ctx, el('form', {class: 'space-y-2'}, field(t.status, status)), ctx.dict.common.save,
  () => request(ctx, endpoint, {method: 'PUT', body: {status: status.value, revision: member.revision}}), {reload: true});
 const canTransfer = member.status === 'active' || member.status === 'paused';
 if (!canTransfer) return statusForm;
 const target = academyLookup(ctx, t.transferTo, async query =>
  (await request(ctx, '/groups?' + new URLSearchParams({q: query, status: 'active', courseId: group.course_id}))).groups
   .filter(item => item.id !== group.id).map(item => ({id: item.id, label: item.name + ' · ' + item.branch})));
 const transferForm = submit(ctx, el('form', {class: 'space-y-2'}, target.node), t.transfer,
  () => {
   const [groupId] = target.ids();
   if (!groupId) throw {code: 'invalid_input'};
   return request(ctx, endpoint + '/transfer', {method: 'POST', body: {groupId, revision: member.revision}});
  }, {reload: true});
 return el('details', {class: 'space-y-3'}, el('summary', {class: 'cursor-pointer'}, t.edit), statusForm, transferForm);
}

function roster(ctx, data, page, query, canManage) {
 const t = words(ctx), group = data.group;
 const href = (partial = {}) => PATH + '?' + new URLSearchParams({group: group.id, q: query, page, ...partial});
 const profile = row => {
  const base = canManage ? '/app/admin/people/' : '/app/teacher/students/';
  const label = row.student_name || row.student_user_id;
  return canManage || row.profile_allowed ? el('a', {href: base + row.student_user_id, class: 'underline'}, label) : label;
 };
 return el('section', {class: 'card space-y-3 p-4'}, title(t.roster),
  searchBar(ctx, t.memberSearch, query, null, q => void ctx.navigate(href({q, page: 1}))),
  data.memberships.length ? el('ul', {class: 'divide-y divide-ink-100'}, data.memberships.map(member =>
   el('li', {class: 'space-y-2 py-3', 'data-academy-member': member.id},
    el('span', {class: 'font-medium'}, profile(member)), el('p', {class: 'text-sm'},
     [t[member.status], member.starts_on, member.ends_on].filter(Boolean).join(' · ')),
    canManage ? memberActions(ctx, group, member) : null))) : el('p', {}, t.noStudents),
  paged(ctx, page, data.hasNext, value => href({page: value})));
}

export async function mount(ctx) {
 const {dict, url, signal} = ctx, t = words(ctx), role = ctx.session?.user?.role;
 const canManage = MANAGERS.includes(role);
 if (!canManage && role !== 'teacher') return;
 const groupId = url.searchParams.get('group');
 const sessionsOnly = groupId && url.searchParams.get('view') === 'sessions';
 const query = (url.searchParams.get('q') || '').slice(0, 120);
 const status = url.searchParams.get('status');
 const filter = GROUP_STATES.includes(status) ? status : '';
 const branchFilter = (url.searchParams.get('branch') || '').slice(0, 120);
 const page = Math.max(1, Math.min(4000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
 const section = el('div', {class: 'space-y-4'});
 const host = el('div', {class: 'mx-auto max-w-6xl space-y-4', 'data-academy-groups': ''},
  BackLink({fallbackHref: groupId && !sessionsOnly ? PATH : '/app/management', label: dict.common.back}),
  el('h1', {class: 'font-display text-3xl'}, t.heading), section);
 ctx.root.append(host);
 host.append(academyHelp(ctx,'groups'));
 if(sessionsOnly){
  if(!UUID.test(groupId)){section.append(el('p',{role:'alert'},errorText(ctx,{code:'invalid_input'})));return;}
  section.append(el('h2',{class:'font-display text-xl'},ctx.locale==='uz'?'Biriktirilgan darslar':'Assigned classes'),
   el('p',{},ctx.locale==='uz'?'Sizga biriktirilgan darslar. Davomat faqat o‘tilgan dars uchun ochiladi.':
    'Your assigned classes. Attendance opens only after a class is marked as held.'),
   sessionPanel(ctx,{id:groupId},[],false));
  return;
 }
 if (!groupId) host.append(attendanceSummary(ctx));
 async function render() {
  if (signal.aborted) return;
  section.replaceChildren(el('p', {role: 'status'}, dict.common.loading));
  try {
   if (groupId) {
    if (!UUID.test(groupId)) throw {code: 'invalid_input'};
    const data = await request(ctx, '/groups/' + groupId + '?' + new URLSearchParams({q: query, page}));
    if (signal.aborted) return;
    const group = data.group;
    replace(section, title(group.name), el('p', {},
     [group.course_title, group.branch, group.room, t[group.status]].filter(Boolean).join(' · ')),
     el('p', {}, data.teachers.map(person => person.name || person.id).join(', ')),
     canManage && group.status !== 'archived' ? groupForm(ctx, data) : null,
     canManage && group.status === 'active' ? enrolForm(ctx, group) : null,
     roster(ctx, data, page, query, canManage),sessionPanel(ctx,group,data.teachers,canManage));
    return;
   }
   const href = (partial = {}) => PATH + '?' + new URLSearchParams({q: query, ...(filter ? {status: filter} : {}), ...(branchFilter ? {branch: branchFilter} : {}), page, ...partial});
   const data = await request(ctx, '/groups?' + new URL(href(), url).searchParams);
   if (signal.aborted) return;
   replace(section, searchBar(ctx, t.groupSearch, query, filter,
    (q, status, branch) => { const target = new URL(PATH, url); target.search = '';
     target.searchParams.set('q', q);
     if (status) target.searchParams.set('status', status);
     if (branch) target.searchParams.set('branch', branch);
     void ctx.navigate(target.pathname + target.search); }, branchFilter),
    canManage ? groupForm(ctx) : null,
    data.groups.length ? el('ul', {class: 'grid gap-3 sm:grid-cols-2'}, data.groups.map(group =>
     el('li', {class: 'card p-4'}, el('a', {class: 'font-semibold underline', href: PATH + '?group=' + group.id}, group.name),
      el('p', {class: 'text-sm'}, [group.course_title, group.branch, t[group.status]].join(' · ')),
      el('p', {class: 'text-sm'}, t.occupancy + ' ' + group.seats + ' / ' + group.capacity)))) : el('p', {}, t.noGroups),
    paged(ctx, page, data.hasNext, value => href({page: value})));
  } catch (error) {
   if (signal.aborted) return;
   const retry = button(dict.common.retry || t.search);
   listen(retry, 'click', render, signal);
   section.replaceChildren(el('p', {role: 'alert'}, errorText(ctx, error)), retry);
  }
 }
 await render();
}

export function studentGroupHistory(ctx, studentId) {
 if(ctx.session?.academyEnabled===false)return null;
 const t = words(ctx), body = el('div', {class: 'space-y-2'});
 const host = el('details', {class: 'card p-4 space-y-3', 'data-academy-history': ''},
  el('summary', {class: 'cursor-pointer font-semibold'}, t.history), body);
 async function load(page) {
  body.replaceChildren(el('p', {role: 'status'}, ctx.dict.common.loading));
  try {
   const data = await request(ctx, '/students/' + studentId + '/groups?page=' + page);
   if (ctx.signal.aborted) return;
   const prev = button(t.previous, {disabled: page === 1}), next = button(t.next, {disabled: !data.hasNext});
   listen(prev, 'click', () => void load(page - 1), ctx.signal);
   listen(next, 'click', () => void load(page + 1), ctx.signal);
   body.replaceChildren(data.memberships.length ? el('ul', {}, data.memberships.map(item =>
    el('li', {class: 'py-1'}, el('a', {class: 'underline', href: PATH + '?group=' + item.group_id}, item.name),
     ' · ' + [item.course_title, t[item.status], item.starts_on, item.ends_on].filter(Boolean).join(' · ')))) :
    el('p', {}, t.noGroups), el('div', {class: 'flex gap-2'}, prev, next));
  } catch (error) {
   if (ctx.signal.aborted) return;
   const retry = button(ctx.dict.common.retry || t.search);
   listen(retry, 'click', () => void load(page), ctx.signal);
   body.replaceChildren(el('p', {role: 'alert'}, errorText(ctx, error)), retry);
  }
 }
 listen(host, 'toggle', () => { if (host.open && !body.childNodes.length) void load(1); }, ctx.signal);
 return host;
}

function sessionPanel(ctx, group, teachers, canManage) {
 const local = ctx.locale === 'uz';
 const t = local ? {
  title:'Dars jadvali', book:'Dars qo‘shish', reschedule:'Ko‘chirish', cancel:'Bekor qilish',
  held:'O‘tgan deb belgilash', room:'Xona', date:'Sana', time:'Boshlanish vaqti', duration:'Davomiylik (daqiqa)',
  weeks:'Haftalar', holidays:'Bayram sanalari (har qatorda YYYY-MM-DD)', reason:'Sabab',
  noSessions:'Darslar hali belgilanmagan.', scheduled:'Rejalangan', cancelled:'Bekor qilingan',
  rescheduled:'Ko‘chirilgan', delivered:'O‘tgan', substitute:'Boshqa o‘qituvchilar', holiday:'Bayram',
 } : {
  title:'Lesson timetable', book:'Schedule lessons', reschedule:'Reschedule', cancel:'Cancel session',
  held:'Mark as held', room:'Room', date:'Date', time:'Start time', duration:'Duration (minutes)',
  weeks:'Weeks', holidays:'Holiday dates (one YYYY-MM-DD per line)', reason:'Reason',
  noSessions:'No lessons scheduled yet.', scheduled:'Scheduled', cancelled:'Cancelled',
  rescheduled:'Rescheduled', delivered:'Held', substitute:'Substitute teachers', holiday:'Holiday',
 };
 const body = el('div', {class:'space-y-3'});
 const panel = el('details', {class:'card space-y-3 p-4', 'data-academy-sessions':''},
  el('summary', {class:'cursor-pointer font-semibold'}, t.title), body);
 const endpoint = '/groups/' + group.id + '/sessions';
 const timeZone = 'Asia/Tashkent';
 function slotForm(row) {
  const ident = crypto.randomUUID();
  const room = el('input',{class:'input',required:true,maxlength:120,value:row?.room??group.room});
  const date = el('input',{class:'input',type:'date',required:true});
  const time = el('input',{class:'input',type:'time',required:true});
  const duration = el('input',{class:'input',type:'number',min:15,max:360,required:true,value:60});
  const weeks = el('input',{class:'input',type:'number',min:1,max:16,required:true,value:1});
  const holidays = el('textarea',{class:'input',maxlength:220,rows:2});
  const reason = el('input',{class:'input',required:true,minlength:3,maxlength:300});
  const substitutes = options(ctx,'teacher',t.substitute,true);
  const form = el('form',{class:'space-y-3','data-academy-session-form':''},
   el('div',{class:'grid gap-2 sm:grid-cols-2'},field(t.room,room),field(t.date,date),field(t.time,time),
    field(t.duration,duration),row?field(t.reason,reason):field(t.weeks,weeks),row?null:field(t.holidays,holidays)),
   el('details',{},el('summary',{class:'cursor-pointer'},t.substitute),substitutes.node));
  return submit(ctx,form,row?t.reschedule:t.book,async()=>{
   const selected = substitutes.ids();
   const fields = {room:room.value.trim(),localDate:date.value,localStart:time.value,
    durationMinutes:duration.valueAsNumber,...(selected.length?{teacherIds:selected}:{})};
   const path = row ? endpoint+'/'+row.id+'/reschedule':endpoint;
   const data = row ? {...fields,reason:reason.value,revision:row.revision,replacementId:ident} :
    {...fields,seriesId:ident,weeks:weeks.valueAsNumber,holidayDates:holidays.value.split(/\s+/).filter(Boolean)};
   await request(ctx,path,{method:'POST',body:data});
   if (!ctx.signal.aborted) await load(1);
  });
 }
 function stateForm(row,status) {
  const cancel = status==='cancelled';
  const reason = el('input',{class:'input',required:true,minlength:3,maxlength:300});
  const form = el('form',{class:'space-y-2'},cancel?field(t.reason,reason):null);
  return submit(ctx,form,cancel?t.cancel:t.held,async()=>{
   await request(ctx,endpoint+'/'+row.id,{method:'PUT',body:{status,revision:row.revision,...(cancel?{reason:reason.value}:{})}});
   if (!ctx.signal.aborted) await load(1);
  });
 }
 async function load(page) {
  body.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try {
   const data = await request(ctx,endpoint+'?page='+page);
   if (ctx.signal.aborted) return;
   const previous = button(words(ctx).previous,{disabled:page===1});
   const next = button(words(ctx).next,{disabled:!data.hasNext});
   listen(previous,'click',()=>void load(page-1),ctx.signal);
   listen(next,'click',()=>void load(page+1),ctx.signal);
   const items = data.sessions.map(row=>el('li',{class:'space-y-2 py-3','data-academy-session':row.id},
    el('p',{class:'font-medium'},paymentDate(row.starts_at,ctx.locale,'—')+' · '+row.room),
    el('p',{class:'text-sm'},[row.status==='held'?t.delivered:t[row.status],
     row.teacher_names.join(', '),row.reason==='holiday'?t.holiday:row.reason].filter(Boolean).join(' · ')),
    row.status==='held'?attendanceRoster(ctx,group.id,row.id):null,
    canManage&&row.status==='scheduled'?el('details',{class:'space-y-2'},
     el('summary',{class:'cursor-pointer'},words(ctx).edit),stateForm(row,'cancelled'),
     new Date(row.ends_at) <= new Date()?stateForm(row,'held'):null,slotForm(row)):null));
   replace(body, el('p',{class:'text-sm'},timeZone),
    canManage&&group.status==='active'?el('details',{class:'space-y-2'},
     el('summary',{class:'cursor-pointer'},t.book),
     el('p',{class:'text-sm'},teachers.map(row=>row.name||row.id).join(', ')),slotForm()):null,
    items.length?el('ul',{class:'divide-y divide-ink-100'},items):el('p',{},t.noSessions),
    el('div',{class:'flex gap-2'},previous,next));
  } catch (error) {
   if (ctx.signal.aborted) return;
   const retry=button(ctx.dict.common.retry||words(ctx).search);
   listen(retry,'click',()=>void load(page),ctx.signal);
   body.replaceChildren(el('p',{role:'alert'},errorText(ctx,error)),retry);
  }
 }
 listen(panel,'toggle',()=>{if(panel.open&&!body.childNodes.length)void load(1);},ctx.signal);
 return panel;
}
