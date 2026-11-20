import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fixtureSession, publicPolicy, testId, viewFixture} from './fixtures.mjs';
import {frames, withDockBrowser} from './helpers/dock-browser.mjs';

const grammarPath = '/app/grammar/practice?book=a2-10';
const readingPath = '/app/reading/general/' + testId;
const examPath = '/app/reading/attempts/' + testId;
const completedId = '00000000-0000-4000-8000-000000000002';
const reviewPath = '/app/reading/attempts/' + completedId;
const studyPath = '/app/study-plan';
const articlesPath = '/app/reading/articles';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const routes = Object.fromEntries([grammarPath, readingPath, examPath, reviewPath, studyPath, articlesPath].map(path => [path, html]));
const readingSet = {
  kind: 'general_set',
  set: {id: testId, title: 'General reading practice'},
  passages: [{
    passageNo: 1, passageId: testId, title: 'Water', body: 'Water freezes at zero degrees.',
    paragraphs: [], groups: [], occurrences: [],
    questions: [{
      id: testId, order: 1, questionNo: 1, type: 'short_answer', typeCode: 'short_answer',
      renderMode: 'question_row', questionText: 'At how many degrees does water freeze?'
    }]
  }],
  initialProgress: {}
};

function viewFor(path) {
  const route = path.split('?')[0];
  if (route === readingPath) return readingSet;
  if (route === examPath || route === reviewPath) {
    const {title, body, questions} = readingSet.passages[0];
    const completed = route === reviewPath;
    return {kind: 'attempt', detail: {
      attempt: {id: completed ? completedId : testId, status: completed ? 'completed' : 'in_progress', startedAt: new Date().toISOString(), score: 0, totalQuestions: 1},
      passage: {title, bodyText: body, suggestedMinutes: 20},
      questions: completed ? questions.map(question => ({...question, correctAnswer: 'zero', explanation: 'Water freezes at zero degrees.'})) : questions,
      sections: [], groups: [], paragraphs: [], answers: [], occurrences: []
    }};
  }
  return viewFixture(path);
}

async function fixtureApi(route) {
  const url = new URL(route.request().url());
  const path = url.searchParams.get('route');
  const session = fixtureSession('owner');
  switch (url.pathname) {
    case '/api/frontend/public': return route.fulfill({json: publicPolicy});
    case '/api/frontend/session': return route.fulfill({json: session});
    case '/api/auth/state': return route.fulfill({json: {role: 'owner', accountStatus: 'active', expiresAt: session.session.expiresAt}});
    case '/api/notifications': return route.fulfill({json: {notifications: [], unread: 0}});
    case '/api/reading/general/progress': return route.fulfill({json: {ok: true, updatedAt: new Date().toISOString()}});
    case '/api/reading/articles/progress': return route.fulfill({json: {completed: []}});
    case '/api/frontend/view': return route.fulfill({json: {version: 1, route: path, data: viewFor(path)}});
    default: return route.fulfill({status: 503, json: {error: 'unavailable'}});
  }
}

test('Reading panes preserve the answer when switching tabs and crossing the phone breakpoint', async () => {
  await withDockBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 320, height: 568}});
    page.setDefaultTimeout(8000);
    await page.route('**/api/**', fixtureApi);
    await page.goto(origin + readingPath);
    const passage = page.locator('#reading-passage-pane');
    const questions = page.locator('#reading-questions-pane');
    const answer = questions.locator('[data-answer-input]');
    const tab = name => page.locator('[aria-controls="reading-' + name + '-pane"]');
    await passage.waitFor();
    assert.equal(await questions.isVisible(), false);
    await tab('questions').click();
    await answer.fill('zero');
    await tab('passage').click();
    assert.equal(await questions.isVisible(), false);
    await tab('questions').click();
    assert.equal(await answer.inputValue(), 'zero');
    assert.equal(await passage.isVisible(), false);

    for (const width of [640, 641, 768, 1440, 390]) {
      await page.setViewportSize({width, height: 900});
      await frames(page);
      assert.equal(await passage.isVisible(), width > 640, String(width));
      assert.equal(await tab('questions').isVisible(), width <= 640, String(width));
      assert.equal(await answer.inputValue(), 'zero');
      assert.equal(await questions.isVisible(), true);
    }
    for (const [path, shortcut] of [[examPath, '[data-reading-question-nav]'], [reviewPath, '.reading-question-button']]) {
      await page.goto(origin + path);
      await passage.waitFor().catch(async error => {
        throw new Error(path + ': ' + await page.locator('body').innerText(), {cause: error});
      });
      await page.locator(shortcut).first().click();
      assert.equal(await questions.isVisible(), true);
      assert.equal(await passage.isVisible(), false);
    }
  }, routes);
});

test('Grammar choices, the profile menu and article titles fit in the available space', async () => {
  await withDockBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 320, height: 568}});
    page.setDefaultTimeout(8000);
    await page.route('**/api/**', fixtureApi);
    // Exercise the native controls before the shadow-root stylesheet applies.
    await page.route('**/modules/grammar/book-runtime.css', route => route.fulfill({contentType: 'text/css', body: ''}), {times: 1});
    await page.goto(origin + grammarPath);
    const choices = page.locator('select.s');
    await choices.first().waitFor();
    assert.ok(await choices.evaluateAll(items => items.every(item => item.getBoundingClientRect().right <= innerWidth)));
    await page.reload();
    await choices.first().waitFor();
    assert.ok(await choices.evaluateAll(items => items.every(item => {
      const box = item.getBoundingClientRect();
      return box.left >= 0 && box.right <= item.parentElement.getBoundingClientRect().right + 1;
    })));
    await page.goto(origin + studyPath);
    const search = page.locator('[data-global-search-trigger]');
    await search.waitFor();
    const triggerBox = await search.boundingBox();
    await search.click();
    const searchBox = await page.locator('[data-global-search-field]').boundingBox();
    assert.ok(Math.abs(searchBox.y - triggerBox.y) <= 1);
    assert.ok(searchBox.x >= 0 && searchBox.x + searchBox.width <= 320);
    await page.keyboard.press('Escape');

    await page.setViewportSize({width: 667, height: 375});
    await page.locator('[data-profile-menu-trigger]').click();
    const menu = page.locator('[data-profile-menu]');
    const box = await menu.boundingBox();
    assert.ok(box.y + box.height <= 375);
    const lastAction = menu.getByRole('menuitem').last();
    await lastAction.scrollIntoViewIfNeeded();
    const actionBox = await lastAction.boundingBox();
    assert.ok(actionBox.y + actionBox.height <= box.y + box.height + 1);

    await page.setViewportSize({width: 768, height: 1024});
    await page.goto(origin + articlesPath);
    const titles = page.locator('.reading-article-title');
    await titles.first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await titles.count() > 1);
    assert.ok(await titles.evaluateAll(items => items.every(item => item.scrollHeight <= item.clientHeight + 1)));
  }, routes);
});
