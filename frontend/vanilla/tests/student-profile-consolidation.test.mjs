import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import staffRoutes from '../modules/staff-final30/routes.js';
import {setup,tick,ID} from './staff-final30/harness.mjs';

const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('admin plan-only entry preserves owner and assigned-teacher full review delegation', async () => {
  const owner = staffRoutes.find(route => route.pattern === '/app/admin/people/:id');
  const teacher = staffRoutes.find(route => route.pattern === '/app/teacher/students/:id');
  assert.deepEqual(owner.roles, ['admin', 'owner']);
  assert.deepEqual(teacher.roles, ['teacher', 'owner']);
  const [ownerView, teacherView] = await Promise.all([owner.load(), teacher.load()]);
  const complete = await import('../modules/staff-final30/teacher.js');
  assert.equal(teacherView.mount, complete.studentMount);
  const entry = source('../modules/staff-final30/staff-student-entry.js');
  assert(entry.includes("if(role==='owner')"));
  assert(entry.includes('return studentMount(ctx)'));
  const fixture = setup({role:'admin',path:'/app/admin/people/'+ID(2)});
  try {
    fixture.stub({'/api/study-plan/monthly/sequence/staff/*':{plan:null,name:'Fixture learner'}});
    await ownerView.mount(fixture.ctx);
    await tick();
    assert(fixture.q('[data-admin-student-plan]'));
    assert(fixture.q('[data-student-plan-inline]'));
    assert.equal(fixture.q('[data-student-full-review]'),null);
    assert.equal(fixture.calls.length,1);
    assert.equal(fixture.calls[0].path,'/api/study-plan/monthly/sequence/staff/'+ID(2));
  } finally { fixture.dispose(); }
});

test('complete student review includes all historical academic and writing sections', () => {
  const detail = source('../modules/staff-final30/teacher.js');
  const extras = source('../modules/shared/student-learning.js');
  for (const required of [
    'renderResults(dict,d.results)',
    'weaknessPanel(ctx,d.weaknesses)',
    'studentLearningPanel(ctx,d.student.id',
    'learningExtras(ctx,{studentId:d.student.id,writing:true})',
    'submissionsSection',
    'data-student-full-review',
  ]) assert(detail.includes(required), required);
  for (const required of ['data-weekly-study-time', 'data-fair-scores', 'data-student-writing-library', 'student-writing?']) {
    assert(extras.includes(required), required);
  }
  assert(detail.includes("max-w-6xl flex-col gap-6"));
});

test('staff academic record endpoints respect owner and assigned teacher authorization', () => {
  const service = source('../../../services/backend/app/browser_staff.py');
  const authority = source('../../../services/backend/app/study_time.py');
  const writing = source('../../../services/backend/app/student_writing.py');
  assert(service.includes("require_role(user, TEACHER_OWNER)"));
  assert(authority.includes("teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2"));
  assert(authority.includes("user['role']!='owner'"));
  assert(writing.includes("if user['role'] not in ('teacher','owner')"));
});

test('study recording schema is isolated and rejects public access', () => {
  const migration = source('../../../services/backend/migrations/0085_restore_student_study_time.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public.study_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public.study_intervals/);
  assert.match(migration, /ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public.study_intervals ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /study_reward_ledger|study_reward_purchases|study_leaderboard_participants/);
  assert.doesNotMatch(migration, /^\\s*(?:DROP|TRUNCATE|DELETE FROM|INSERT INTO)\\b/im);
});
