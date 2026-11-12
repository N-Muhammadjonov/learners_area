import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {validateSession} from '../js/adapters/frontend.js';
import {entryDestination} from '../js/session.js';
import {api} from '../js/api-client.js';

test('guardian sessions are accepted with the existing, unmodified schema', () => {
  const session = validateSession({
    version: 1,
    session: {
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Guardian',
        email: null,
        role: 'guardian',
        accountStatus: 'active',
        locale: 'uz',
        onboarded: true,
        photoPresent: false,
      },
      expiresAt: 2000000000,
      accessEventsEnabled: true,
      diagnostics: false,
    },
  });
  assert.equal(session.user.role, 'guardian');
});

test('valid guardian session enters My Progress directly, with no extra login', async () => {
  const original = api.request;
  api.request = async path => {
    assert.equal(path, '/api/auth/state');
    return {ok: true, role: 'guardian', accountStatus: 'active'};
  };
  try {
    assert.equal(await entryDestination(), '/app/progress');
  } finally {
    api.request = original;
  }
});

test('site exchanges the one-time proof before navigating to guardian progress', () => {
  const source = fs.readFileSync(new URL('../modules/auth/public.js', import.meta.url), 'utf8');
  assert.match(source, /\/api\/auth\/telegram\/intent\/exchange/);
  assert.match(source, /result\.role==='guardian'\?'\/app\/progress'/);
  assert.match(source, /window\.history\.replaceState/);
  const authority = fs.readFileSync(new URL('../js/authority.js', import.meta.url), 'utf8');
  assert.match(authority, /\['student','teacher','admin','owner','guardian'\]/);
});
