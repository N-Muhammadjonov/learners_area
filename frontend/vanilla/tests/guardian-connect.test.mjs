import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  const owner = routes.filter(r => r.pattern === '/app/management/guardians');
  assert.equal(owner.length, 1);
  assert.deepEqual(owner[0].roles, ['owner']);
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
