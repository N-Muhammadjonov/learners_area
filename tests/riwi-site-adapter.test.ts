import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { PORTABLE_SCHEMA_VERSION, RIWI_CORE_VERSION } from '../src/lib/portability/types';
import type { RiwiActor } from '../src/lib/services/riwi/capabilities';
import type { RiwiSiteAdapter } from '../src/lib/services/riwi/site-adapter';
import { RiwiToolBroker, type RiwiToolContract } from '../src/lib/services/riwi/tool-broker';

const actor: RiwiActor = { id: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'student', accountStatus: 'active' };
const contract: RiwiToolContract = {
  name: 'site.read', version: '1', description: 'Scoped adapter acceptance read', capability: 'riwi.progress.read_self',
  riskClass: 'read-only', inputSchema: z.object({}).strict(), outputSchema: z.object({ value: z.string() }).strict(),
  timeoutMs: 40, idempotencyMode: 'none', auditMode: 'required', externalDataClass: 'none', allowedRoles: ['student'],
  rowScopeResolver: async (user) => ({ allowed: true, kind: 'self', userIds: [user.id] }), confirmationRequired: false,
};
const adapter = (resolveActor: RiwiSiteAdapter['resolveActor']): RiwiSiteAdapter => ({ portableSchemaVersion: PORTABLE_SCHEMA_VERSION, riwiCoreVersion: RIWI_CORE_VERSION, resolveActor });
const context = { actor, correlationId: 'bbbbbbbb-0000-4000-8000-000000000001' };

test('site adapter rejects incompatible schema/core versions before registration', () => {
  for (const field of ['portableSchemaVersion', 'riwiCoreVersion'] as const) {
    assert.throws(() => new RiwiToolBroker(async () => {}, { ...adapter(async () => actor), [field]: 'unsupported' }), /riwi_site_adapter_incompatible/);
  }
});

test('persisted actor mismatch, deletion and authority errors cannot invoke a tool', async () => {
  for (const resolve of [async () => null, async () => ({ ...actor, role: 'owner' as const }), async () => ({ ...actor, accountStatus: 'suspended' as const }), async () => { throw new Error('unavailable'); }]) {
    let invoked = 0;
    const broker = new RiwiToolBroker(async () => {}, adapter(resolve));
    broker.register(contract, async () => { invoked++; return { value: 'private' }; });
    assert.deepEqual(await broker.call(contract.name, {}, context), { ok: false, code: 'riwi_permission_denied' });
    assert.equal(invoked, 0);
  }
});

test('role revocation during invocation audit prevents handler execution', async () => {
  let current: RiwiActor | null = actor;
  let invoked = 0;
  const broker = new RiwiToolBroker(async (event) => { if (event.action === 'riwi.tool.invoked') current = null; }, adapter(async () => current));
  broker.register(contract, async () => { invoked++; return { value: 'private' }; });
  assert.deepEqual(await broker.call(contract.name, {}, context), { ok: false, code: 'riwi_permission_denied' });
  assert.equal(invoked, 0);
});

test('revocation during handler suppresses private output and success audit', async () => {
  let current: RiwiActor | null = actor;
  const actions: string[] = [];
  const broker = new RiwiToolBroker(async (event) => { actions.push(event.action); }, adapter(async () => current));
  broker.register(contract, async () => { current = null; return { value: 'private' }; });
  assert.deepEqual(await broker.call(contract.name, {}, context), { ok: false, code: 'riwi_permission_denied' });
  assert.equal(actions.includes('riwi.tool.succeeded'), false);
});

test('unresponsive authority lookup is bounded both before invocation and after output', { timeout: 1000 }, async () => {
  for (const stalledAt of [1, 3]) {
    let lookups = 0;
    const broker = new RiwiToolBroker(async () => {}, adapter(async () => ++lookups === stalledAt ? new Promise<never>(() => {}) : actor));
    broker.register(contract, async () => ({ value: 'private' }));
    const result = await broker.call(contract.name, {}, context);
    assert.equal(result.ok, false);
  }
});

test('compatible independent site preserves strict schemas and successful audited reads', async () => {
  const broker = new RiwiToolBroker(async () => {}, adapter(async () => actor));
  broker.register(contract, async () => ({ value: 'bounded' }));
  assert.deepEqual(await broker.call(contract.name, {}, context), { ok: true, value: { value: 'bounded' } });
  assert.deepEqual(await broker.call(contract.name, { extra: true }, context), { ok: false, code: 'riwi_tool_invalid_input' });
});

test('revocation while success audit is pending still suppresses returned data', async () => {
  let current: RiwiActor | null = actor;
  const broker = new RiwiToolBroker(async (event) => { if (event.action === 'riwi.tool.succeeded') current = null; }, adapter(async () => current));
  broker.register(contract, async () => ({ value: 'private' }));
  assert.deepEqual(await broker.call(contract.name, {}, context), { ok: false, code: 'riwi_permission_denied' });
});
