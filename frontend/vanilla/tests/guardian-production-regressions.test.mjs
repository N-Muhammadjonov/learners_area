/** Regression: guardian login survives JWT validation; staff People and errors render safely. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {validateDirectory} from '../js/adapters/staff-final30/people.js';
import {ROLES, ROLE_LABELS} from '../js/adapters/staff-final30/core.js';
import {RegionFailureNotice} from '../modules/shared/presentation.js';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';
import {withOverlays} from '../js/i18n/with-overlays.js';

const ID = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-11-12T12:00:00Z';

test('People accepts guardian rows without making guardian an assignable role', () => {
  const dto = {
    people: [{id: ID, name: 'Ota-ona', email: null, role: 'guardian',
      accountStatus: 'active', statusReason: null, createdAt: stamp,
      telegramLinked: true, username: 'parent', phoneNumber: null}],
    filters: {q: '', role: 'guardian', status: null, online: false},
    page: 1, pageSize: 25, total: 1, totalPages: 1,
    actorId: ID, actorRole: 'owner', grantableRoles: ['student', 'teacher', 'admin', 'owner']
  };
  const value = validateDirectory(dto);
  assert.equal(value.people[0].role, 'guardian');
  assert.equal(value.filters.role, 'guardian');
  assert.equal(ROLE_LABELS.guardian.uz, 'Ota-ona');
  assert(ROLES.includes('guardian'));
  assert(!value.grantableRoles.includes('guardian'));
});

test('both dictionaries provide a nonempty retry label', () => {
  assert.equal(withOverlays(uz, 'uz').common.retry, 'Qayta urinish');
  assert.equal(withOverlays(en, 'en').common.retry, 'Try again');
});

test('error notice never renders an unlabeled retry button', () => {
  const dom = new JSDOM('<!doctype html><html lang="uz"><body></body></html>');
  const prior = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const notice = RegionFailureNotice({region: 'people', message: 'Unavailable'});
    const button = notice.querySelector('button');
    assert.equal(button.textContent, 'Qayta urinish');
    assert.equal(button.getAttribute('aria-label'), 'Qayta urinish');
    assert.equal(button.getAttribute('type'), 'button');
  } finally {
    globalThis.document = prior;
    dom.window.close();
  }
});
