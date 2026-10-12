import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Production build, disposable process, no database and no real bot credentials.
// This is policy/transport regression proof, never real Telegram E2E acceptance.
async function verify(mode, port) {
  const env = { ...process.env, NODE_ENV: 'production', PUBLIC_AUTH_MODE: mode,
    PUBLIC_BASE_URL: 'https://learnersarea.uz',
    TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN: 'https://learnersarea.uz',
    TELEGRAM_BOT_TOKEN: 'local-fixture-only', TELEGRAM_BOT_USERNAME: 'local_fixture_bot',
    AUTH_SECRET: 'disposable-fixture-secret-for-http-test',
  };
  for (const key of ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']) delete env[key];
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const request = (path, init = {}) => fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });
  try {
    const deadline = Date.now() + 45_000;
    while (true) {
      try { if ((await request('/api/version')).ok) break; } catch { /* startup */ }
      assert.equal(child.exitCode, null, `server exited: ${output.slice(-1500)}`);
      assert.ok(Date.now() < deadline, `startup timed out: ${output.slice(-1500)}`);
      await delay(250);
    }
    const login = await request('/login');
    assert.equal(login.status, 200);
    const html = await login.text();
    assert.equal(/type="email"/.test(html), mode === 'standard');
    const csp = login.headers.get('content-security-policy');
    assert.match(csp, /nonce-/);
    assert.match(csp, /frame-src[^;]*https:\/\/oauth.telegram.org/);
    for (const path of ['/api/auth/login', '/api/auth/register', '/api/auth/reset/request', '/api/auth/reset/confirm']) {
      const res = await request(path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(res.status, mode === 'telegram-only' ? 403 : 400, path);
      assert.equal(res.headers.get('set-cookie'), null);
    }
    for (const path of ['/api/auth/google/start', '/api/auth/google/callback']) {
      const res = await request(path);
      assert.equal(res.status, mode === 'telegram-only' ? 403 : 307, path);
    }
    const recovery = await request('/auth/recovery');
    assert.equal(recovery.status, 200);
    assert.match(await recovery.text(), /type="password"/);
    const invalidRecovery = await request('/api/auth/recovery/login', { method: 'POST', body: '{}', headers: { origin: base } });
    assert.equal(invalidRecovery.status, 400);
    const crossSite = await request('/api/auth/recovery/login', { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: '{}' });
    assert.equal(crossSite.status, 403);
    const invalidTelegram = await request('/api/auth/telegram/callback?id=123&hash=bad&auth_date=1');
    assert.equal(invalidTelegram.status, 307);
    assert.ok(invalidTelegram.headers.get('location').endsWith('/login?error=telegram'));
    assert.equal(invalidTelegram.headers.get('set-cookie'), null);
    if (mode === 'telegram-only') {
      const registration = await request('/register');
      assert.equal(registration.status, 200);
      assert.doesNotMatch(await registration.text(), /type="email"|type="password"/);
      for (const path of ['/reset-password', '/reset-password/confirm']) {
        const reset = await request(path);
        assert.equal(reset.status, 307);
        assert.ok(reset.headers.get('location').endsWith('/login'));
      }
    }
    console.log(`${mode}: HTTP policy, recovery, origin, cookies, CSP and invalid Telegram callback PASS`);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
}
await verify('standard', 3101);
await verify('telegram-only', 3102);
