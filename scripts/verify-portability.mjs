import assert from 'node:assert/strict';

// Run against an isolated, seeded production-mode Node server, never production.
const target = new URL(process.env.QA_BASE_URL || 'http://127.0.0.1:3101');
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'local QA server only');
const base = target.origin;
const canonical = new URL(process.env.QA_CANONICAL_ORIGIN || 'https://portable-qa.example').origin;
const home = await fetch(base + '/');
const html = await home.text();
assert.equal(home.status, 200);
const canonicalTag = html.match(/<link rel="canonical" href="([^"]+)"/);
assert.equal(new URL(canonicalTag?.[1] || 'about:blank').origin, canonical);
assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
console.log('PASS configured canonical + preview noindex on generic Node');
const robots = await (await fetch(base + '/robots.txt')).text();
assert.match(robots, /Disallow: \//);
assert.ok(!robots.includes('Allow: /login'));
const sitemap = await (await fetch(base + '/sitemap.xml')).text();
assert.ok(!sitemap.includes('<loc>'));
console.log('PASS preview robots and empty sitemap');
const request = (path, body, extra = {}) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...extra }, body: JSON.stringify(body),
});
for (const email of ['demo.student@learnersarea.uz', 'nobody@example.test']) {
  const result = await request('/api/auth/reset/request', { email });
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'reset_unavailable' });
}
console.log('PASS no production reset-token exposure or account enumeration');
assert.equal((await request('/api/auth/login', {}, { origin: 'https://' + target.host })).status, 403);
console.log('PASS scheme mismatch rejected');
const login = await request('/api/auth/login', { email: 'demo.student@learnersarea.uz', password: 'Student12345!' });
assert.equal(login.status, 200);
const rawCookies = login.headers.getSetCookie();
assert.ok(rawCookies.every((cookie) => !cookie.toLowerCase().includes('domain=')));
const cookie = rawCookies.map((value) => value.split(';')[0]).join('; ');
console.log('PASS generic Node login and host-only cookie');
for (const path of ['/app/dashboard', '/app/reading', '/app/notifications', '/app/reading']) {
  const result = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const text = await result.text();
  assert.equal(result.status, 200);
  assert.ok(!text.includes('data-app-error'));
  assert.ok(!text.includes('NEXT_REDIRECT'));
  console.log('PASS direct/repeat render', path);
}
const denied = await fetch(base + '/app/teacher/support', { headers: { cookie }, redirect: 'manual' });
const deniedHtml = await denied.text();
assert.ok(!deniedHtml.includes('data-report-id='));
assert.ok([302, 307, 404].includes(denied.status) || deniedHtml.includes('NEXT_REDIRECT'));
console.log('PASS staff guard with streaming response; no report data leaked');
const version = await (await fetch(base + '/api/version')).json();
assert.equal(version.environment, 'preview');
assert.ok(version.commit);
console.log('PASS portable build identity');
