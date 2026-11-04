import asyncio
import importlib.util
import json
import re
from pathlib import Path

import httpx
from app.frontend_static import StaticFrontend


def builder():
    path=Path(__file__).resolve().parents[3]/'scripts/build_native_assets.py'
    spec=importlib.util.spec_from_file_location('asset_builder',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def fixture(tmp_path):
    files={'index.html':'<!doctype html><html><head><link rel="stylesheet" href="/css/global.css"></head><body><script type="module" src="/js/main.js"></script></body></html>',
        'js/main.js':"import {value} from './child.js'; console.log(value);",
        'js/child.js':'/*! retained license */\nexport const value = '+json.dumps('abc'*2000)+';',
        'js/generated/view-registry.js':'export default [];',
        'js/vendor/riwi-speech/qa/index.html':'<!doctype html><script type="module" src="probe.js"></script>',
        'css/global.css':'/* removable */\n.a { color: green; margin: 0; }\n'*50,
        'css/fonts.css':'body { font-family: sans-serif; }',
        'routes.json':json.dumps({'version':1,'routes':['/app/test'],'redirects':[]})}
    for name,content in files.items():
        path=tmp_path/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
    result=builder().build(tmp_path)
    return result,json.loads((tmp_path/'build/asset-manifest.json').read_text())


def test_build_is_versioned_deterministic_minified_and_python_only(tmp_path):
    first,manifest=fixture(tmp_path)
    second=builder().build(tmp_path)
    assert first==second
    assert first['nodeRequired'] is False
    assert first['transferBytes']<first['inputBytes']
    html=(tmp_path/'build/index.html').read_text()
    assert '/assets/'+first['revision']+'/js/main.js' in html
    assert 'name="la-build"' in html
    assert '/*! retained license */' in (tmp_path/'build/js/child.js').read_text()
    assert manifest['files']['js/child.js']['gzipBytes']<manifest['files']['js/child.js']['bytes']
    (tmp_path/'js/child.js').write_text('export const value=2;')
    assert builder().build(tmp_path)['revision']!=first['revision']


def test_static_headers_gzip_etag_range_and_stale_deployment(tmp_path,monkeypatch):
    info,manifest=fixture(tmp_path);monkeypatch.setenv('FRONTEND_DIST',str(tmp_path/'build'))
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=StaticFrontend()),base_url='https://fixture.invalid') as client:
            url='/assets/'+info['revision']+'/js/child.js'
            response=await client.get(url,headers={'accept-encoding':'gzip'})
            assert response.status_code==200
            assert response.headers['content-encoding']=='gzip'
            assert 'immutable' in response.headers['cache-control']
            assert response.headers['vary']=='Accept-Encoding'
            assert response.content==(tmp_path/'build/js/child.js').read_bytes()
            repeated=await client.get(url,headers={'accept-encoding':'gzip','if-none-match':response.headers['etag']})
            assert repeated.status_code==304 and not repeated.content
            plain=await client.get(url,headers={'accept-encoding':'gzip;q=0'})
            assert 'content-encoding' not in plain.headers
            ranged=await client.get(url,headers={'Range':'bytes=0-9','accept-encoding':'gzip'})
            assert ranged.status_code==206
            assert ranged.content==plain.content[:10]
            assert 'content-encoding' not in ranged.headers
            assert not (await client.head(url)).content
            legacy=await client.get('/js/child.js')
            assert 'immutable' not in legacy.headers['cache-control']
            old=await client.get('/assets/00000000000000000000/js/child.js')
            assert old.status_code==404 and old.headers['cache-control']=='no-store'
            assert old.headers['x-learners-asset-version']==info['revision']
            document=await client.get('/')
            assert document.headers['cache-control']=='private, no-store'
            assert 'Content-Security-Policy' in document.headers
            assert 'nonce=' in document.text
            probe=await client.get('/js/vendor/riwi-speech/qa/index.html')
            nonce=re.search(r'nonce="([a-f0-9]+)"',probe.text)[1]
            assert "'nonce-"+nonce+"'" in probe.headers['content-security-policy']
            assert "'strict-dynamic'" in probe.headers['content-security-policy']
            assert probe.headers['cache-control']=='private, no-store'
            assert (await client.get('/assets/'+info['revision']+'/.gzip/js/child.js.gz')).status_code==404
    asyncio.run(run())
