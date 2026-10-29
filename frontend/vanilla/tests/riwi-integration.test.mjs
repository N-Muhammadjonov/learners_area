import {test} from 'node:test';
import assert from 'node:assert/strict';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';
import routes from '../js/routes.js';
import {breadcrumbsFor} from '../js/generated/nav-routes.js';
import {createRiwiWorkspaceController, escapeHtml, RIWI_WORKSPACE_ROUTE} from '../modules/riwi/index.js';
import {createOwnerRiwiControlRoom, OWNER_RIWI_ROUTE} from '../modules/staff-final30/owner-riwi.js';
import {renderObjectiveExplanationWidget} from '../modules/riwi/objective-explanation.js';

test('en.js and uz.js retain identical key shapes including RIWI copy', () => {
  function keys(o, p = '') {
    return Object.entries(o).flatMap(([k, v]) => typeof v === 'object' && v !== null ? keys(v, p + k + '.') : [p + k]).sort();
  }
  assert.deepEqual(keys(en), keys(uz));
  assert.equal(typeof en.riwi.title, 'string');
  assert.equal(typeof uz.riwi.title, 'string');
});

test('/app/riwi and /app/owner/riwi are protected native routes with breadcrumbs', async () => {
  const rRiwi = routes.find((r) => r.pattern === RIWI_WORKSPACE_ROUTE);
  const rOwner = routes.find((r) => r.pattern === OWNER_RIWI_ROUTE);
  assert.equal(rRiwi?.protected, true);
  assert.equal(rOwner?.protected, true);
  assert.deepEqual(rOwner?.roles, ['owner']);
  assert.equal(typeof (await rRiwi.load()).mount, 'function');
  assert.equal(typeof (await rOwner.load()).mount, 'function');
  assert.equal(breadcrumbsFor('/app/riwi', en).length, 1);
  assert.equal(breadcrumbsFor('/app/owner/riwi', en).length, 3);
});

test('RIWI workspace and objective explanation widgets escape untrusted HTML and enforce post-submission gate', async () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(renderObjectiveExplanationWidget({attemptSubmitted: false, attemptId: 'a', questionId: 'q'}), '');
  const ctrl = createRiwiWorkspaceController({
    role: 'student',
    locale: 'en',
    adapter: {
      sendChat: async () => ({
        ok: true,
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer: 'Safe answer <img src=x onerror=alert(1)>',
        provenance: 'canonical_grammar',
        citations: [],
        reportSnapshot: null
      })
    }
  });
  await ctrl.sendMessage('Explain articles');
  const html = ctrl.renderHtml();
  assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!html.includes('<img src=x'));
  assert.throws(() => createOwnerRiwiControlRoom({role: 'student'}));
});
