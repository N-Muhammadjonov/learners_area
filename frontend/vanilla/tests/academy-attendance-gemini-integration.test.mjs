import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  studentCalendar, attendanceSummary
} from '../modules/staff-final30/academy-attendance.js';
import {ID, setup, tick} from './staff-final30/harness.mjs';

test('own calendar loads lazily with a bounded page and no staff endpoint', async () => {
  const h=setup({path:'/app/progress',role:'student',locale:'uz'});
  h.stub({
    '/api/academy/calendar':{
      page:1,hasNext:false,sessions:[{
        id:ID(11),group_id:ID(12),group_name:'IELTS Morning',
        starts_at:'2026-11-15T10:00:00+05:00',
        session_status:'scheduled',attendance_status:null
      }]
    }
  });
  try {
    const panel=studentCalendar(h.ctx);
    h.ctx.root.append(panel);
    assert.equal(h.calls.length,0);
    panel.open=true;
    await tick(); await tick();
    assert.match(panel.textContent,/IELTS Morning/);
    assert.equal(h.calls.length,1);
    assert.match(h.calls[0].path,/\/api\/academy\/calendar\?page=1/);
    assert.equal(panel.querySelectorAll('button').length,2);
    assert([...panel.querySelectorAll('button')].every(btn=>btn.disabled));
  } finally {h.dispose();}
});

test('teacher attendance summary is lazy and renders held-session rate', async () => {
  const h=setup({path:'/app/management/groups',role:'teacher',locale:'uz'});
  h.stub({
    '/api/staff/academy/attendance/summary':{
      groups:[{
        group_id:ID(3),group_name:'IELTS Morning',branch:'Namangan',
        held_sessions:8,cancelled_sessions:2,attended_marks:9,
        attendanceRate:.75
      }],
      branches:[{
        branch:'Namangan',groupCount:1,heldSessions:8,
        attendanceRate:.75
      }]
    }
  });
  try {
    const panel=attendanceSummary(h.ctx);
    h.ctx.root.append(panel);
    assert.equal(h.calls.length,0);
    panel.open=true;
    await tick(); await tick();
    assert.match(panel.textContent,/IELTS Morning/);
    assert.match(panel.textContent,/75/);
    assert.equal(h.calls.length,1);
    assert.match(h.calls[0].path,/\/attendance\/summary\?/);
  } finally {h.dispose();}
});
