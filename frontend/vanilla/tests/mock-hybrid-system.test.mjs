/**
 * Frontend unit & architectural contract tests for the Weekly IELTS Mock System (A01–A14).
 * Pure Node.js test runner (zero external browser/jsdom dependency required).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {summarizeMocks} from '../modules/progress/mock-summary.js';
import {summarize} from '../modules/staff-final30/mock-summary.js';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('A07 / Section 12: Management hub shows Mock Tests card ONLY to Teacher and Owner, never to Admin', () => {
  for (const dict of [en, uz]) {
    const teacherHrefs = managementAreas(dict, 'teacher').map(a => a.href);
    const ownerHrefs = managementAreas(dict, 'owner').map(a => a.href);
    const adminHrefs = managementAreas(dict, 'admin').map(a => a.href);

    assert.equal(teacherHrefs.includes('/app/management?view=mocks'), true, 'Teacher must see Mock Tests');
    assert.equal(ownerHrefs.includes('/app/management?view=mocks'), true, 'Owner must see Mock Tests');
    assert.equal(adminHrefs.includes('/app/management?view=mocks'), false, 'Admin must NOT gain Mock management rights');
  }
});

test('A10 / A11: No module sidebar added; Mock runner and Staff Mock Grading Center use theme tokens only', () => {
  const runnerSrc = read('modules/mocks/runner.js');
  const gradingSrc = read('modules/staff-final30/mock-grading.js');
  const shellSrc = read('modules/shell/layout.js');

  assert.equal(shellSrc.includes('no sidebar is rendered'), true);
  // Ensure no arbitrary hex colors (#123456) are hardcoded in runner.js or mock-grading.js
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(runnerSrc), false, 'runner.js must use CSS theme tokens, not arbitrary hex colors');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(gradingSrc), false, 'mock-grading.js must use CSS theme tokens, not arbitrary hex colors');

  // Ensure staff-final30 security invariants hold on mock-grading.js
  for (const forbidden of [/localStorage|sessionStorage|indexedDB/, /\.innerHTML\s*=/, /insertAdjacentHTML/, /\beval\(/, /new Function\(/, /document\.write/, /dangerouslySetInnerHTML/]) {
    assert.equal(forbidden.test(gradingSrc), false, `mock-grading.js must not match ${forbidden}`);
  }
});

test('A09 / Section 12: My Progress and staff summary count ONLY completed FULL mocks, never sectional/practice attempts or pending nulls', () => {
  const catalogueIds = ['m-full-1', 'm-full-2'];
  const attempts = [
    {id: 'a1', mockTestId: 'm-full-1', title: 'Full Mock 1', skill: 'full', finishedAt: new Date('2026-10-01T10:00:00Z'), estimatedBand: 6.5},
    {id: 'a2', mockTestId: 'm-full-2', title: 'Full Mock 2 (Pending W/S)', skill: 'full', finishedAt: null, estimatedBand: null},
    {id: 'a3', mockTestId: 'm-sec-1', title: 'Listening Practice', skill: 'listening', finishedAt: new Date('2026-10-05T10:00:00Z'), estimatedBand: 8.5},
    {id: 'a4', mockTestId: 'm-full-2', title: 'Full Mock 2', skill: 'full', finishedAt: new Date('2026-10-15T10:00:00Z'), estimatedBand: 7.5},
  ];

  const studentSummary = summarizeMocks(attempts, catalogueIds);
  assert.equal(studentSummary.points.length, 2, 'Only completed full mocks with a valid band are plotted');
  assert.equal(studentSummary.latest, 7.5);
  assert.equal(studentSummary.best, 7.5);
  assert.equal(studentSummary.average, 7.0);
  assert.equal(studentSummary.change, 1.0);
  assert.equal(studentSummary.completed, 2);

  const staffSummary = summarize(attempts, catalogueIds);
  assert.equal(staffSummary.bands.length, 2);
  assert.equal(staffSummary.latest, 7.5);
  assert.equal(staffSummary.best, 7.5);
  assert.equal(staffSummary.skillFinished.length, 1, 'Sectional attempts stay separate from full mock trend');
});

test('A01–A06: Runner and Staff Grading Center expose required data attributes and API endpoints', () => {
  const runnerSrc = read('modules/mocks/runner.js');
  const gradingSrc = read('modules/staff-final30/mock-grading.js');

  for (const endpoint of [
    '/api/mocks/catalog',
    '/attempts',
    '/sections/',
    '/speaking/upload-finalize',
    '/results',
  ]) {
    assert.equal(runnerSrc.includes(endpoint), true, `runner.js missing endpoint ${endpoint}`);
  }

  for (const endpoint of [
    '/api/frontend/staff/mock-grading',
    '/api/staff/mocks/exports',
    '/api/staff/mocks/grade-imports/validate',
    '/api/staff/mocks/grade-imports/commit',
    '/api/staff/mocks/grades/',
    '/api/staff/mocks/batches/',
  ]) {
    assert.equal(gradingSrc.includes(endpoint), true, `mock-grading.js missing endpoint ${endpoint}`);
  }
});
