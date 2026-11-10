"""The optional release probe must remain bounded, read-only and secret-free."""
import asyncio
import importlib.util
import json
from pathlib import Path
import httpx
import pytest

spec=importlib.util.spec_from_file_location('phase2_smoke',Path(__file__).resolve().parents[3]/'scripts/phase2_readonly_smoke.py')
smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)

def test_readonly_probe_checks_revision_range_and_etag_without_recording_private_values(monkeypatch):
    revision='1234567890abcdef1234';requests=[];secret='synthetic-session-value-do-not-log'
    def reply(req):
        requests.append(req);path=req.url.path
        if path=='/api/frontend/session':return httpx.Response(200 if req.headers.get('cookie') else 401,json={'privateSentinel':secret})
        if path=='/api/version':return httpx.Response(200,json={'commit':'expected','region':'local','environment':'test','secret':secret})
        if path.startswith('/api/') or path in ('/healthz','/readyz'):return httpx.Response(200,json={'ok':True,'secret':secret})
        if path=='/':return httpx.Response(200,text=f'<meta name="la-build" content="{revision}"><link href="/assets/{revision}/css/global.css"><script src="/assets/{revision}/js/main.js"></script>',headers={'content-type':'text/html'})
        if path.startswith('/assets/'+'0'*20):return httpx.Response(404,json={'error':'asset_version_changed'},headers={'cache-control':'no-store'})
        headers={'cache-control':'public, max-age=31536000, immutable','etag':'"fixture"','vary':'Accept-Encoding','accept-ranges':'bytes'}
        if req.headers.get('if-none-match'):return httpx.Response(304,headers=headers)
        if req.headers.get('range'):return httpx.Response(206,content=b'0123456789',headers={**headers,'content-range':'bytes 0-9/20'})
        return httpx.Response(200,content=b'01234567890123456789',headers=headers)
    original=httpx.AsyncClient
    monkeypatch.setattr(smoke.httpx,'AsyncClient',lambda **kw:original(**kw,transport=httpx.MockTransport(reply)))
    monkeypatch.setenv('QA_READ_ONLY_COOKIE',secret)
    result=asyncio.run(smoke.smoke('https://fixture.invalid','expected'))
    assert result['failed']==0
    assert {r.method for r in requests}=={'GET'}
    assert secret not in json.dumps(result)
    assert {r['classification'] for r in result['checks']} >= {'ok','partial_content','not_modified','not_found','authentication_required'}

@pytest.mark.parametrize('origin',['https://user:secret@fixture.invalid','https://fixture.invalid/?token=value','http://external.invalid','https://fixture.invalid/private'])
def test_probe_rejects_credential_urls_and_non_loopback_plain_http(origin):
    with pytest.raises(ValueError):asyncio.run(smoke.smoke(origin))
