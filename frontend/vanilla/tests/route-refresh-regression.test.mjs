import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = new URL('../js/routes.js', import.meta.url);
const catalogue = new URL('../routes.json', import.meta.url);

test('all SPA routes support direct browser refresh through static route manifest', () => {
  const javascript = readFileSync(source, 'utf8');
  const manifest = JSON.parse(readFileSync(catalogue, 'utf8'));
  const routes = [...javascript.matchAll(/\bpattern\s*:\s*["']([^"']+)["']/g)]
    .map(match => match[1].replace(/:[A-Za-z][A-Za-z0-9_]*/g, '[^/]+'));
  assert(routes.length > 100, 'Unexpectedly short route inventory');
  assert.equal(manifest.version, 1);
  const missing = [...new Set(routes.filter(route => !manifest.routes.includes(route)))];
  assert.deepEqual(missing, [], 'Client routes missing from server-rendered refresh allowlist');
  for (const required of ['/app/leaderboard', '/app/plan/level-check', '/app/grammar/practice']) {
    assert(manifest.routes.includes(required), required + ' must serve HTML on refresh');
  }
});

test('unknown and internal routes stay outside SPA refresh allowlist', () => {
  const manifest = JSON.parse(readFileSync(catalogue, 'utf8'));
  const disallowed = ['/api/coins/media/heartbeat', '/api/internal/telegram/coins/referral',
    '/.env', '/services/backend/app/main.py', '/_frontend'];
  for (const value of disallowed) {
    assert(!manifest.routes.includes(value), value + ' must never be an SPA document');
  }
});
