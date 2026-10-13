import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';

// Disposable native PostgreSQL + built server. Never a real Telegram E2E claim.
const url = new URL(process.env.TEST_DATABASE_URL || 'http://invalid');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/learners_telegram_ci',
  'Only the explicitly named local CI database is allowed');
const pool = new pg.Pool({ connectionString: url.toString() });
let child;
const base = 'http://127.0.0.1:3110';
const secret = 'fixture-service-secret-no-production-access';
const headers = { origin: base, 'content-type': 'application/json' };
async function request(path, body, extra = {}) {
  return fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000),
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(path, body, extra) {
  const response = await request(path, body, extra);
  return { response, data: await response.json() };
}
const internal = { authorization: 'Bearer ' + secret };
async function intent(purpose = 'login', cookie) {
  const r = await json('/api/auth/telegram/intent', { purpose }, cookie ? { cookie } : {});
  assert.equal(r.response.status, 200);
  return r.data;
}
async function confirm(value, telegramUserId) {
  const r = await request('/api/internal/telegram/auth/confirm',
    { token: value.token, telegramUserId, displayName: 'Fixture applicant', languageCode: 'en' }, internal);
  assert.equal(r.status, 200);
}
async function exchange(value, nonce = value.browserNonce) {
  return json('/api/auth/telegram/intent/exchange', { intentId: value.intentId, browserNonce: nonce });
}
try {
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync('drizzle/' + file, 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) {
      await pool.query(statement);
    }
  }
  const passwordHash = await bcrypt.hash('fixture-password-only', 4);
  for (const [role, id] of [['owner','9001'], ['admin','9002'], ['student','9003']]) {
    await pool.query("insert into users (name,email,password_hash,role,account_status,telegram_id,locale,onboarding_completed_at) values ($1,$2,$3,$4,'active',$5,'en',now())",
      [role + ' fixture', role + '@fixture.invalid', passwordHash, role, id]);
  }
  const before = (await pool.query('select id,role,password_hash from users order by telegram_id')).rows;
  const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: url.toString(),
    AUTH_SECRET: 'fixture-signing-secret-no-production-access', PUBLIC_BASE_URL: base,
    PUBLIC_AUTH_MODE: 'standard', TELEGRAM_INTENT_AUTH_ENABLED: 'true',
    TELEGRAM_BOT_USERNAME: 'local_fixture_bot', TELEGRAM_BOT_TOKEN: 'fixture-only',
    TELEGRAM_OWNER_ID: '9001', BOT_SERVICE_SECRET: secret };
  delete env.TELEGRAM_ACCESS_GATES_ENABLED;
  delete env.TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN;
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3110'],
    { env, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  child.stdout.on('data', c => { output += c; });
  child.stderr.on('data', c => { output += c; });
  const deadline = Date.now() + 45_000;
  while (true) {
    try { if ((await request('/api/version')).ok) break; } catch { /* startup */ }
    assert.equal(child.exitCode, null, 'fixture server exited');
    assert.ok(Date.now() < deadline, 'fixture startup timed out');
    await delay(250);
  }
  assert.equal((await request('/api/internal/telegram/ready')).status, 401);
  assert.equal((await request('/api/internal/telegram/ready', undefined, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request('/api/internal/telegram/ready', undefined, internal)).status, 200);
  const html = await (await request('/login')).text();
  assert.match(html, /type="email"/); assert.match(html, /type="password"/);
  for (const role of ['owner','admin']) {
    const login = await json('/api/auth/login', { email: role+'@fixture.invalid', password: 'fixture-password-only' });
    assert.equal(login.response.status, 200);
    const recovery = await json('/api/auth/recovery/login', { email: role+'@fixture.invalid', password: 'fixture-password-only' });
    assert.equal(recovery.response.status, 200);
  }
  const deniedRecovery = await request('/api/auth/recovery/login', { email:'student@fixture.invalid', password:'fixture-password-only' });
  assert.equal(deniedRecovery.status, 401);
  const pending = await intent();
  assert.equal((await exchange(pending)).response.status, 400);
  await confirm(pending, '9001');
  assert.equal((await exchange(pending, 'wrong-nonce')).response.status, 400);
  const signedIn = await exchange(pending);
  assert.equal(signedIn.response.status, 200);
  assert.match(signedIn.response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await exchange(pending)).response.status, 409);
  const cookie = signedIn.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/auth/telegram/intent', { purpose:'register' }, {cookie})).status, 409);

  const cancelled = await intent(); await confirm(cancelled, '9003');
  assert.equal((await request('/api/auth/telegram/intent/cancel', {intentId:cancelled.intentId,browserNonce:cancelled.browserNonce})).status, 200);
  assert.equal((await exchange(cancelled)).response.status, 400);
  const expired = await intent(); await confirm(expired, '9003');
  await pool.query("update telegram_login_intents set expires_at=now()-interval '1 second' where id=$1", [expired.intentId]);
  assert.equal((await exchange(expired)).response.status, 400);
  const unknown = await intent(); await confirm(unknown, '9004');
  assert.equal((await exchange(unknown)).response.status, 404);
  assert.equal(Number((await pool.query("select count(*) from users where telegram_id='9004'")).rows[0].count), 0);

  const registered = await intent('register'); await confirm(registered, '9004');
  const student = await exchange(registered);
  assert.equal(student.response.status, 200); assert.equal(student.data.accountStatus, 'pending');
  const applicant = (await pool.query("select id,role,account_status from users where telegram_id='9004'")).rows[0];
  assert.equal(applicant.role, 'student');
  const requestId = (await pool.query("select id from access_requests where user_id=$1 and status='pending'", [applicant.id])).rows[0].id;
  const decide = actorTelegramId => request('/api/internal/telegram/admission/decide', { actorTelegramId,requestId,decision:'approve' }, internal);
  assert.equal((await decide('9004')).status, 403);
  // Website admin status alone must not silently grant bot permissions.
  assert.equal((await decide('9002')).status, 403);
  const admin = (await pool.query("select id from users where telegram_id='9002'")).rows[0];
  await pool.query("insert into telegram_bot_admins (telegram_user_id,linked_user_id,permissions) values ('9002',$1,'[\"ADMISSIONS\"]')", [admin.id]);
  assert.equal((await request('/api/internal/telegram/admission/pending?actorTelegramId=9001', undefined, internal)).status, 200);
  assert.equal((await decide('9002')).status, 200);
  assert.equal((await pool.query('select account_status from users where id=$1',[applicant.id])).rows[0].account_status, 'active');
  await pool.query("update telegram_bot_admins set is_active=false where telegram_user_id='9002'");
  assert.equal((await request('/api/internal/telegram/admission/pending?actorTelegramId=9002',undefined,internal)).status, 403);
  const approvedLogin = await intent(); await confirm(approvedLogin,'9004');
  const approved = await exchange(approvedLogin);
  assert.equal(approved.data.accountStatus,'active'); assert.equal(approved.data.onboarded,false);
  // Suspension wins over a still-valid signed cookie on the next protected API request.
  await pool.query("update users set account_status='suspended' where id=$1",[applicant.id]);
  const staleCookie=approved.response.headers.get('set-cookie').split(';')[0];
  const protectedResponse=await request('/api/vocabulary/due',undefined,{cookie:staleCookie});
  assert.equal(protectedResponse.status,401);
  const after = (await pool.query("select id,role,password_hash from users where telegram_id in ('9001','9002','9003') order by telegram_id")).rows;
  assert.deepEqual(after,before);
  console.log('PASS: native PostgreSQL migrations, credentials, owner/admin recovery, intent confirmation, replay, cancellation, expiry, registration, admission and permission revocation');
  console.log('Fixture verification only; real Telegram/production E2E remains required.');
} finally {
  if (child && child.exitCode === null) { const exited=once(child,'exit');child.kill('SIGTERM');await exited; }
  await pool.end();
}
