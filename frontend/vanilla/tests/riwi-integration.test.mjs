import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';
import routes from '../js/routes.js';
import {breadcrumbsFor} from '../js/generated/nav-routes.js';
import {createRiwiWorkspaceController, escapeHtml, RIWI_WORKSPACE_ROUTE} from '../modules/riwi/index.js';
import {createOwnerRiwiControlRoom, OWNER_RIWI_ROUTE} from '../modules/staff-final30/owner-riwi.js';
import {renderObjectiveExplanationWidget, loadObjectiveExplanation} from '../modules/riwi/objective-explanation.js';

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
  const btnHtml = renderObjectiveExplanationWidget({attemptSubmitted: true, attemptId: 'a1', questionId: 'q1', locale: 'en'});
  assert(btnHtml.includes('data-attempt-id="a1"'));
  assert(btnHtml.includes('Explain Official Answer'));

  const resolvedHtml = renderObjectiveExplanationWidget({
    attemptSubmitted: true,
    attemptId: 'a1',
    questionId: 'q1',
    locale: 'en',
    explanationData: {explanation: 'Answer B is supported by paragraph 2 <script>x</script>'}
  });
  assert(resolvedHtml.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert(!resolvedHtml.includes('<script>x</script>'));

  const expData = await loadObjectiveExplanation({
    module: 'reading',
    attemptId: 'a1',
    questionId: 'q1',
    locale: 'en',
    adapter: {
      explainObjectiveQuestion: async (req) => ({ok: true, explanation: `Explained ${req.module}:${req.questionId}`})
    }
  });
  assert.equal(expData.explanation, 'Explained reading:q1');

  const ctrl = createRiwiWorkspaceController({
    role: 'student',
    locale: 'en',
    adapter: {
      sendChat: async () => ({
        ok: true,
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer: 'Safe answer <img src=x onerror=alert(1)>',
        provenance: 'canonical_grammar',
        citations: ['K1'],
        reportSnapshot: null
      }),
      deleteConversation: async () => ({ok: true, deleted: true}),
      submitFeedback: async () => ({ok: true, signal: {id: 'sig-1'}}),
      touchPresence: async () => ({ok: true, recorded: true})
    }
  });
  await ctrl.sendMessage('Explain articles');
  const html = ctrl.renderHtml();
  assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!html.includes('<img src=x'));
  assert(html.includes('[K1]'));

  const fb = await ctrl.submitFeedback({helpful: false, reason: 'Need more examples'});
  assert.equal(fb.ok, true);
  assert.equal(ctrl.state.feedbackSubmitted, true);

  await ctrl.clearConversation();
  assert.equal(ctrl.state.conversationId, null);
  assert.equal(ctrl.state.messages.length, 0);
});

test('Teacher and Owner role surfaces support target learner selection, cursor pagination, and Owner Control Room tabs', async () => {
  const teacherCtrl = createRiwiWorkspaceController({
    role: 'teacher',
    locale: 'uz',
    adapter: {
      listTargets: async (cursor) => ({
        ok: true,
        items: cursor ? [{id: 's2', name: 'Vali Aliyev'}] : [{id: 's1', name: 'Ali Valiyev'}],
        nextCursor: cursor ? null : 'cur-page-2'
      }),
      sendChat: async (payload) => ({
        ok: true,
        conversationId: '22222222-2222-4222-8222-222222222222',
        answer: `Report for ${payload.targetUserId}`,
        provenance: 'canonical_progress',
        citations: []
      })
    }
  });
  await teacherCtrl.loadTargets();
  assert.equal(teacherCtrl.state.targetOptions.length, 1);
  assert.equal(teacherCtrl.state.nextTargetCursor, 'cur-page-2');
  await teacherCtrl.loadTargets('cur-page-2');
  assert.equal(teacherCtrl.state.targetOptions.length, 2);

  teacherCtrl.state.targetUserId = 's2';
  const res = await teacherCtrl.sendMessage('Show learner progress');
  assert.equal(res.answer, 'Report for s2');
  assert(teacherCtrl.renderHtml().includes('riwi-target-select'));

  assert.throws(() => createOwnerRiwiControlRoom({role: 'student'}));
  assert.throws(() => createOwnerRiwiControlRoom({role: 'admin'}));

  const ownerRoom = createOwnerRiwiControlRoom({
    role: 'owner',
    locale: 'en',
    theme: 'night',
    adapter: {
      getOwnerDiagnostics: async () => ({
        ok: true,
        rollout: {enabled: true, externalAi: false},
        providers: [{id: 'riwi', displayName: 'RIWI Deterministic Engine', secretsPresent: true}]
      }),
      getOwnerSecuritySignals: async () => ({
        ok: true,
        items: [{id: 'sec-1', signal_type: 'prompt_injection', state: 'open'}]
      }),
      getOwnerAudit: async () => ({
        ok: true,
        items: [{id: 'aud-1', action: 'riwi.chat.completed'}],
        nextCursor: 'aud-cur-2'
      })
    }
  });
  assert.equal(ownerRoom.setTab('providerLab'), 'providerLab');
  assert(ownerRoom.renderHtml().includes('data-active-tab="providerLab"'));
  const diag = await ownerRoom.refreshDiagnostics();
  assert.equal(diag.rollout.enabled, true);
  const sigs = await ownerRoom.refreshSecuritySignals();
  assert.equal(sigs.length, 1);
  const aud = await ownerRoom.refreshAudit();
  assert.equal(aud.nextCursor, 'aud-cur-2');
});

test('All RIWI Vanilla JS modules pass strict ESM syntax verification', () => {
  const baseDir = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
  const riwiFiles = [
    'js/i18n/riwi_i18n.js',
    'js/adapters/riwi.js',
    'modules/riwi/index.js',
    'modules/riwi/objective-explanation.js',
    'modules/staff-final30/owner-riwi.js'
  ];
  for (const rel of riwiFiles) {
    const full = join(baseDir, rel);
    const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(full),
      encoding: 'utf8'
    });
    assert.equal(checked.status, 0, `${rel} failed ESM check: ${checked.stderr}`);
  }
});
