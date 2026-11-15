import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import routes from '../js/routes.js';
import {mount} from '../modules/staff-final30/academy-capacity.js';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {setup, tick} from './staff-final30/harness.mjs';

const url = '/app/management/capacity';
const api = '/api/staff/academy/capacity/group';
const groups = '/api/staff/academy/groups?status=active&page=1';

test('only the owner can use the packaged Capacity Explorer route', () => {
  const staticRoutes = JSON.parse(readFileSync(new URL('../routes.json',import.meta.url), 'utf8'));
  assert(staticRoutes.routes.includes(url));
  const route = routes.find(item => item.pattern === url);
  assert.equal(route.protected, true);
  assert.deepEqual(route.roles, ['owner']);
  const h = setup({role:'owner',path:url});
  try {
    for (const role of ['owner','admin','teacher','student','guardian']) {
      assert.equal(managementAreas(h.ctx.dict,role).some(item => item.href === url), role === 'owner');
    }
  } finally {
    h.dispose();
  }
});

test('simulation preserves exact money, percentages and the read-only schedule scope', async () => {
  const h = setup({role:'owner',path:url});
  const outcome = {
    billableStudents:8, studentsOverCapacity:0, seatUseBps:8000, invoicedMinor:'9007199254740993',
    recognizedMinor:'40001', cashFromTuitionMinor:'30000', cashFromOpeningDebtMinor:'55',
    cashTotalMinor:'30055', unpaidTuitionMinor:'10001', teacherCostMinor:'39999', contributionMinor:'-1',
  };
  const scenario = {...outcome,months:[{...outcome,month:1},{...outcome,month:2,billableStudents:6}]};
  const actuals = {
    range:{start:'2026-10-16',end:'2026-11-15'}, invoicedTuitionMinor:'0', collectedNetMinor:'0',
    recognizedRevenueMinor:'0', outstandingReceivableMinor:'0', overdueReceivableMinor:'0',
  };
  try {
    h.stub({
      [groups]: () => ({groups:[{id:'group',name:'IELTS B2',branch:'Tashkent'}],hasNext:false}),
      [api]: (_url, request) => request.method === 'POST'
        ? {schedule:{feasible:false,conflicts:['room'],teacherMinutesRequired:60,staffingGapMinutes:0},
           scenarios:[scenario,scenario,scenario], academyActuals:actuals,
           operatingHistory:{start:'2026-10-16',end:'2026-11-15',course_trials_completed:3,
             enrollments_from_leads:2,withdrawals:1,scheduled_lessons:6,held_lessons:4,taught_minutes:240}}
        : {groupId:'group',groupName:'IELTS B2',capacity:10,reservedSeats:8,room:'North',today:'2026-11-15'},
    });
    await h.mount({mount});
    h.submit(h.q('[data-capacity-group]').closest('form'));
    await tick();
    const form = h.q('[data-capacity-simulation]');
    assert(form);
    for (const [name, value] of Object.entries({
      tuitionMinor:'9007199254740993', discountBps:'1,25', collectionBps:'75', cashWithinPeriodBps:'80',
      forecastMonths:'2',retentionBps:'75',sessionsPerMonth:'4',
      deliveryBps:'50', teacherRateMinor:'200001', teacherMinutesAvailable:'600', localStart:'11:30',
    })) h.input(form.elements.namedItem(name), value);
    h.submit(form);
    await tick();
    const submission = h.calls.find(item => item.method === 'POST');
    assert.equal(submission.body.tuitionMinor, '9007199254740993');
    assert.equal(submission.body.discountBps, 125);
    assert.equal(submission.body.forecastMonths,2);
    assert.equal(submission.body.retentionBps,7500);
    assert.equal(submission.body.sessionsPerMonth,4);
    assert.deepEqual(submission.body.slot, {localDate:'2026-11-15',localStart:'11:30',durationMinutes:60,room:'North'});
    assert(h.q('table').textContent.includes('9,007,199,254,740,993 UZS'));
    assert(h.q('table').textContent.includes('-1 UZS'));
    assert(h.ctx.root.textContent.includes('Schedule conflicts · Room'));
    assert.match(h.q('details table tbody tr:nth-child(2)').textContent,/26/);
    assert.match(h.ctx.root.textContent,/Course trials completed3/);
    assert.deepEqual(h.calls.map(item => item.method), ['GET','GET','POST']);
  } finally {
    h.dispose();
  }
});
