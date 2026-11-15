import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const origin = process.env.RESCUE_TEST_ORIGIN;
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
const {tokens, group, learner, teacher} = JSON.parse(readFileSync(0, 'utf8'));
const route = '/app/management/rescue';
const queue = '/api/staff/academy/rescue';
const actions = queue+'/'+group+'/'+learner+'/actions';
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE || undefined});

async function pageFor(name, width = 1440) {
  const context = await browser.newContext({viewport: {width, height: 920}, serviceWorkers: 'block'});
  await context.route('**/*', request => new URL(request.request().url()).origin === origin
    ? request.continue() : request.abort());
  await context.addCookies([
    {name: 'la_session', value: tokens[name], url: origin, httpOnly: true, sameSite: 'Lax'},
    {name: 'la_locale', value: 'en', url: origin},
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  return page;
}

function responseTo(page, method, path) {
  return page.waitForResponse(response =>
    new URL(response.url()).pathname === path && response.request().method() === method);
}

try {
  const owner = await pageFor('Owner');
  await owner.goto(origin+'/app/management');
  await owner.getByRole('link', {name: /Learner support/}).click();
  await owner.waitForURL('**'+route);
  await owner.locator('[data-rescue-student="'+learner+'"]').waitFor();
  await owner.getByText('Support thresholds', {exact: true}).click();
  await owner.locator('[name="attendancePercent"]').fill('80');
  const thresholds = responseTo(owner, 'PUT', queue+'/thresholds');
  await owner.getByRole('button', {name: 'Save thresholds'}).click();
  assert.equal((await thresholds).status(), 200);
  await owner.getByText('Thresholds saved.').waitFor();

  await owner.locator('[data-rescue-filter]').selectOption('');
  const cards = owner.locator('[data-rescue-student]');
  await cards.nth(24).waitFor();
  const firstPage = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.rescueStudent));
  await owner.getByRole('button', {name: 'Next', exact: true}).click();
  await owner.getByText('Page 2', {exact: true}).waitFor();
  const secondPage = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.rescueStudent));
  assert.equal(firstPage.length, 25);
  assert.equal(secondPage.length, 2);
  assert.equal(new Set([...firstPage, ...secondPage]).size, 27);

  const assigned = await pageFor('Assigned teacher', 390);
  await assigned.goto(origin+route);
  const card = assigned.locator('[data-rescue-student="'+learner+'"]');
  await card.getByText('Test learner').waitFor();
  assert.equal(await assigned.locator('[data-rescue-thresholds]').count(), 0);
  await card.getByText(/Attendance/).click();
  await card.getByText(/Evidence IDs/).waitFor();

  async function saveAction(action, reason) {
    const form = card.locator('[data-rescue-case-form]');
    await form.locator('[data-rescue-action]').selectOption(action);
    assert.equal(await form.getByLabel('Follow-up date').isVisible(), false);
    await form.getByRole('textbox', {name: 'Reason or note'}).fill(reason);
    const saved = responseTo(assigned, 'POST', actions);
    await form.getByRole('button', {name: 'Save action'}).click();
    const result = await saved;
    assert.equal(result.status(), 200, await result.text());
    return result.json();
  }
  assert.equal((await saveAction('claim', 'Discuss missed lessons')).assignedTo, teacher);
  await card.getByText('Case status · Claimed', {exact: true}).waitFor();
  assert.equal((await saveAction('resolve', 'Learner attended the review')).status, 'resolved');
  await assigned.reload();
  await card.getByText('Case status · Resolved', {exact: true}).waitFor();
  await card.getByText('Action history').click();
  await card.getByText(/Learner attended the review/).waitFor();

  const outsider = await pageFor('Unassigned teacher');
  await outsider.goto(origin+route);
  await outsider.getByText('No learners match this filter.').waitFor();
  assert.equal((await outsider.request.get(origin+actions)).status(), 404);
  for (const role of ['Test learner', 'Guardian']) {
    const page = await pageFor(role);
    assert.equal((await page.request.get(origin+queue)).status(), 403);
  }

  const capacity = '/app/management/capacity';
  const capacityApi = '/api/staff/academy/capacity/'+group;
  await owner.goto(origin+capacity);
  await owner.getByRole('button', {name:'Load group'}).click();
  const form = owner.locator('[data-capacity-simulation]');
  for (const [field, value] of Object.entries({
    projectedStudents:'1', tuitionMinor:'200001', discountBps:'10', collectionBps:'75', cashWithinPeriodBps:'80',
    forecastMonths:'3', retentionBps:'100', sessionsPerMonth:'2',
    deliveryBps:'50', teacherRateMinor:'10000', teacherMinutesAvailable:'60', localStart:'16:00',
  })) await form.locator('[name="'+field+'"]').fill(value);
  const report = responseTo(owner, 'POST', capacityApi);
  await form.getByRole('button', {name:'Calculate scenarios'}).click();
  const result = await report;
  assert.equal(result.status(), 200, await result.text());
  const scenario = await result.json();
  assert.equal(scenario.scenarios[1].invoicedMinor, '540003');
  assert.deepEqual(scenario.scenarios[1].months.map(month=>month.billableStudents), [1,1,1]);
  assert.equal(scenario.schedule.feasible, true);
  await owner.getByRole('table', {name:'Simulated values'}).waitFor();
  await owner.getByText('Neutral · Monthly forecast', {exact:true}).click();
  await owner.getByRole('row', {name:/^3 1 180,001 UZS/}).waitFor();
  await owner.getByRole('heading', {name:'Recorded academy activity'}).waitFor();
  assert.equal((await assigned.request.get(origin+capacityApi)).status(), 403);

  console.log(JSON.stringify({rescueBrowserJourney:'passed', capacityBrowserJourney:'passed',
    roles:5, widths:[1440,390], paginated:27}));
} finally {
  await browser.close();
}
