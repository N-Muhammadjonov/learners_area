const backend = 'https://learners-area-hsi8ndnuf-learners-area.vercel.app';
const mainCommit = 'd62a2302a8dee9e72ccd6e7812a5ca7c7e4f50ec';
const backendCommit = '81a389f4506fadc5d8ed7066ec32c1f859059157';
const pendingPage = `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Learners Area · RIWI sinov muhiti</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0a1a39;color:#f0f4ff}*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px}main{max-width:760px;width:100%}
.brand{color:#e9c66b;font-weight:700;letter-spacing:.13em;font-size:13px}h1{font-size:clamp(30px,6vw,48px);line-height:1.12}
p,li{line-height:1.7;color:#ccd5e6}.state{display:inline-block;border:1px solid #e9c66b66;border-radius:24px;padding:7px 14px;color:#f4d782}
section{border:1px solid #ffffff20;border-radius:16px;padding:22px;margin:24px 0;background:#ffffff05}
a{color:#f4d782;text-underline-offset:4px}code{font-size:13px;overflow-wrap:anywhere}.small{font-size:13px}
</style></head><body><main><p class="brand">LEARNERS AREA / RIWI</p>
<p class="state">To‘liq ulanish kutilmoqda</p><h1>Yopiq sinov muhiti yaratildi.</h1>
<p>Learners Area va RIWI’ning bu manzilda to‘liq ishlashi hali tasdiqlanmagan. FastAPI test backendi yig‘ilgan; Sites orqali kirish va QA bazasini yangilash hozir bloklangan.</p>
<section aria-label="Sinov holati"><ul>
<li><code>arena/learners-area-next</code> hozirgi <code>main</code> va RIWI commitlarini o‘z ichiga oladi.</li>
<li>QA bazasi: 66 ta migratsiya tekshirildi. 13 ta asosiy va 2 ta qo‘shimcha migratsiya qo‘llanmadi.</li>
<li>Vercel preview himoyasi saqlangan. Sites uchun server kirish kaliti o‘rnatilmagan.</li>
<li>RIWI semantik baholash va o‘qitish talablari bo‘yicha hali to‘liq tayyor emas.</li>
</ul></section><p><a href="${backend}" target="_blank" rel="noopener noreferrer">Himoyalangan test backendini ochish ↗</a></p>
<p class="small">Main: <code>${mainCommit.slice(0,12)}</code> · Backend: <code>${backendCommit.slice(0,12)}</code><br>
Asosiy saytga merge yoki production o‘zgarishi bajarilmagan. Ushbu sahifa muvaffaqiyatli RIWI sinovi hisoblanmaydi.</p>
</main></body></html>`;

function failure(request, code, status = 503) {
  const headers = {'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  if (new URL(request.url).pathname.startsWith('/api/')) return Response.json({error:code}, {status, headers});
  headers['content-type'] = 'text/html; charset=utf-8';
  headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
  return new Response(request.method === 'HEAD' ? null : pendingPage, {status, headers});
}

export async function gateway(request, env, send = fetch) {
  const url = new URL(request.url);
  // Sites owns its owner-private access boundary. ChatGPT identity is never
  // mapped to a Learners Area role; native application authorization remains.
  if (url.pathname === '/__riwi/status' && ['GET','HEAD'].includes(request.method)) {
    return Response.json({state: env.BACKEND_ACCESS_TOKEN ? 'connection_unverified' : 'blocked',
      mainCommit, backendCommit, branch:'arena/learners-area-next',
      databaseMigration:'blocked_pending_approval', liveRiwiValidated:false},
      {headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow'}});
  }
  if (!env.BACKEND_ACCESS_TOKEN) return failure(request, 'backend_access_not_configured');
  if (!['GET','HEAD','OPTIONS'].includes(request.method) && request.headers.get('origin') !== url.origin) {
    return failure(request, 'cross_origin', 403);
  }
  const target = new URL(url.pathname + url.search, backend);
  // URL normalizes a leading // path as an authority; pin the destination.
  if (target.origin !== backend) return failure(request, 'invalid_backend_path', 400);
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (/^(oai-|x-vercel-|x-forwarded-|cf-access-)/i.test(key) ||
        ['authorization','proxy-authorization','host','forwarded'].includes(key)) headers.delete(key);
  }
  const cookies = (request.headers.get('cookie') || '').split(';')
    .map(value => value.trim()).filter(value => /^la_[A-Za-z0-9_-]+=/.test(value));
  headers.delete('cookie');
  if (cookies.length) headers.set('cookie', cookies.join('; '));
  headers.set('x-vercel-protection-bypass', env.BACKEND_ACCESS_TOKEN);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.slice(0,-1));
  let upstream;
  try {
    upstream = await send(target, {method:request.method, headers,
      body:['GET','HEAD'].includes(request.method) ? undefined : request.body,
      duplex:'half', redirect:'manual', signal:AbortSignal.timeout(60000)});
  } catch {
    return failure(request, 'backend_unavailable');
  }
  const responseHeaders = new Headers(upstream.headers);
  const location = responseHeaders.get('location');
  if (location) {
    const destination = new URL(location, backend);
    if (destination.origin !== backend || [...destination.searchParams.keys()].some(key => /vercel|share|bypass/i.test(key))) {
      return failure(request, 'backend_redirect_requires_review');
    }
    destination.protocol = url.protocol;
    destination.host = url.host;
    responseHeaders.set('location', destination.href);
  }
  const setCookies = typeof upstream.headers.getAll === 'function'
    ? upstream.headers.getAll('set-cookie') : upstream.headers.getSetCookie();
  responseHeaders.delete('set-cookie');
  for (const cookie of setCookies) if (/^la_[A-Za-z0-9_-]+=/.test(cookie)) responseHeaders.append('set-cookie', cookie);
  for (const key of [...responseHeaders.keys()]) if (/^(oai-|x-vercel-)/i.test(key)) responseHeaders.delete(key);
  responseHeaders.set('cache-control','private, no-store');
  responseHeaders.set('x-robots-tag','noindex, nofollow');
  return new Response(request.method === 'HEAD' ? null : upstream.body,
    {status:upstream.status, statusText:upstream.statusText, headers:responseHeaders});
}

export default {fetch(request, env) {return gateway(request, env);}};
