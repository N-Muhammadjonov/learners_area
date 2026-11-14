import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError} from '../js/api-client.js';
import routes from '../js/routes.js';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {mount, studentGroupHistory} from '../modules/staff-final30/academy-groups.js';
import {dicts, ID, setup, tick} from './staff-final30/harness.mjs';

const path = '/app/management/groups';
const endpoint = '/api/staff/academy';
const group = {id: ID(10), name: 'IELTS morning', course_id: ID(2), course_title: 'IELTS',
 branch: 'Tashkent', room: '203', seats: 1, capacity: 1, starts_on: '2026-11-01', status: 'active', revision: 1};
const member = {id: ID(15), student_user_id: ID(3), student_name: 'Student 3', status: 'active',
 starts_on: '2026-11-01', revision: 4, profile_allowed: false};
const detail = {group, memberships: [member], teachers: [{id: ID(4), name: 'Teacher'}], hasNext: false};

test('academy route and Management card are scoped to staff', () => {
 const route = routes.find(entry => entry.pattern === path);
 assert.deepEqual(route.roles, ['teacher', 'admin', 'owner']);
 assert.equal(route.protected, true);
 for (const role of ['teacher','admin','owner','student','guardian']) {
  assert.equal(managementAreas(dicts.en, role).some(card => card.href === path), route.roles.includes(role));
 }
});

test('teacher sees the roster and can only open a linked student profile', async () => {
 const h = setup({path: path + '?group=' + group.id, role: 'teacher', locale: 'uz'});
 h.stub({[endpoint + '/groups/' + group.id]: detail});
 try {
  await mount(h.ctx);
  assert.equal(h.q('h1').textContent, 'Akademiya guruhlari');
  assert.equal(h.q('[data-academy-group-form]'), null);
  assert.equal(h.q('[data-academy-member] a'), null);
  assert.match(h.q('[data-academy-member]').textContent, /Student 3/);
  assert.equal(h.calls.length, 1);
 } finally { h.dispose(); }
});

test('transfer uses the selected destination and current revision, with one write per pending save', async () => {
 const h = setup({path: path + '?group=' + group.id, role: 'admin'});
 const target = {...group, id: ID(11), name: 'IELTS afternoon'};
 let finish, refreshes = 0;
 h.ctx.refresh = async () => { refreshes++; };
 const base = endpoint + '/groups/' + group.id;
 h.stub({
  [base]: detail,
  [base + '/memberships/' + member.id + '/transfer']: () => new Promise(resolve => { finish = resolve; }),
  [endpoint + '/groups']: {groups: [group, target], hasNext: false},
 });
 try {
  await mount(h.ctx);
  const form = h.qa('[data-academy-member] form')[1];
  const [search, select, transfer] = form.querySelectorAll('button');
  h.click(search);
  await tick();
  assert.equal(form.querySelector('select').value, target.id);
  h.click(select);
  h.submit(form);
  h.submit(form);
  await tick();
  assert(transfer.disabled);
  const writes = h.calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, {groupId: target.id, revision: 4});
  assert(h.calls.some(call => new URL(call.path, h.ctx.url).searchParams.get('courseId') === group.course_id));
  finish({id: ID(16)});
  await tick();
  assert.equal(refreshes, 1);
 } finally { h.dispose(); }
});

test('roster read errors can be retried and profile history loads only when opened', async () => {
 const h = setup({path, role: 'owner'});
 let reads = 0;
 h.stub({
  [endpoint + '/groups']: () => ++reads === 1 ? new ApiError(503, 'database_unavailable') :
   {groups: [group], hasNext: false},
  [endpoint + '/students/' + member.student_user_id + '/groups']:
   {memberships: [{group_id: group.id, name: group.name, status:'transferred'}], hasNext: false},
 });
 try {
  await mount(h.ctx);
  assert(h.q('[role="alert"]'));
  h.click(h.q('[data-academy-groups] button'));
  await tick();
  assert(h.q('a[href="' + path + '?group=' + group.id + '"]'));
  const history = studentGroupHistory(h.ctx, member.student_user_id);
  h.ctx.root.append(history);
  assert.equal(h.calls.length, 2);
  history.open = true;
  await tick();
  assert.match(history.textContent, /Transferred/);
  assert.equal(h.calls.length, 3);
 } finally { h.dispose(); }
});
