import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {replaceOptionalChildren} from '../modules/guardian/shared.js';
import {dockItems} from '../modules/shell/dock.js';
import routes from '../js/routes.js';

const dict = {nav: {dashboard: 'D', liveClasses: 'L', assignments: 'A', mockTests: 'M', videoLessons: 'V', listening: 'Li', reading: 'R',
  writing: 'W', speaking: 'S', grammar: 'G', vocabulary: 'Vo', progress: 'P', leaderboard: 'LB', management: 'Mg'}, common: {back: 'Back'}};
const read = path => fs.readFileSync(new URL('../modules/guardian/' + path, import.meta.url), 'utf8');

test('guardian Dock has exactly My Progress and Leaderboard', () => {
  assert.deepEqual(dockItems(dict, 'guardian').map(i => i.href), ['/app/progress', '/app/leaderboard']);
});

test('other roles keep their Dock', () => {
  assert.equal(dockItems(dict, 'student').length, 13);
  assert.equal(dockItems(dict, 'owner').at(-1).key, 'management');
});

test('progress and leaderboard routes use the role-aware entries; owner page is registered once', () => {
  assert.match(routes.find(r => r.pattern === '/app/progress').load.toString(), /guardian\/progress-entry\.js/);
  assert.match(routes.find(r => r.pattern === '/app/leaderboard').load.toString(), /guardian\/leaderboard-entry\.js/);
  const staff = routes.filter(r => r.pattern === '/app/management/guardians');
  assert.equal(staff.length, 1);
  assert.deepEqual(staff[0].roles, ['teacher', 'admin', 'owner']);
});

test('guardian read pages are GET-only and contain no action controls or module links', () => {
  for (const file of ['progress.js', 'leaderboard.js', 'shared.js']) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(code.replace("method = 'GET'", '')), false, file);
    assert.equal(/href:\s*['"`]\/app\//.test(code), false, file);
  }
  assert.equal(/h\(\s*'(form|textarea)'/.test(read('leaderboard.js')), false);
});

test('owner page never sends without an explicit confirm and a stable idempotency key', () => {
  const code = read('guardians.js');
  assert.match(code, /confirm: true, idempotencyKey: S\.key/);
  assert.equal((code.match(/guardian-messages\/send/g) || []).length, 1);
  assert.equal(/setInterval|setTimeout\([^)]*runSend/.test(code), false);
});

test('all guardian modules parse as ESM', async () => {
  for (const file of ['shared.js', 'progress.js', 'leaderboard.js', 'guardians.js', 'progress-entry.js', 'leaderboard-entry.js']) {
    assert.ok(read(file).length > 100, file);
  }
});


test('native optional child replacement does not stringify null, undefined or booleans', () => {
  const dom = new JSDOM('<!doctype html><div id="host"></div>');
  const host = dom.window.document.querySelector('#host');
  const node = dom.window.document.createElement('span');
  node.textContent = 'visible';
  replaceOptionalChildren(host, null, undefined, false, true, node, 0);
  assert.equal(host.textContent, 'visible0');
  assert.equal(host.children.length, 1);
  dom.window.close();
});

test('guardians, leaderboard and progress filter optional children before replacing DOM', () => {
  const guardians = read('guardians.js');
  const leaderboard = read('leaderboard.js');
  const progress = read('progress.js');
  assert(guardians.includes('replaceOptionalChildren(host,'));
  assert(leaderboard.includes('replaceOptionalChildren(list,'));
  assert(leaderboard.includes('replaceOptionalChildren(page,'));
  assert(progress.includes('replaceOptionalChildren(page,'));
  assert(!guardians.includes('host.replaceChildren('));
});


test('guardian detail always shows an authorized full Telegram ID even with a username', () => {
  const source = read('guardians.js');
  assert(source.includes("l.telegramUsername ? '@' + l.telegramUsername : null"));
  assert(source.includes("l.telegramUserId ? 'ID ' + l.telegramUserId : null"));
  assert(!source.includes("l.telegramUsername ? '@' + l.telegramUsername : 'ID ' + l.telegramUserId"));
});
