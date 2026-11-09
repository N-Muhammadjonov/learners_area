import asyncio
import hashlib
import json
from pathlib import Path

import httpx
from app.frontend_static import StaticFrontend


def test_ranges_stream_without_reading_the_entire_asset_and_respect_if_range(tmp_path, monkeypatch):
    payload = b'0123456789abcdef' * (512 * 1024)
    file = tmp_path / 'js/large.bin'
    file.parent.mkdir()
    file.write_bytes(payload)
    sha = hashlib.sha256(payload).hexdigest()
    (tmp_path / 'asset-manifest.json').write_text(json.dumps({
        'version': 1, 'revision': '1234567890abcdef1234', 'routes': ['/'],
        'files': {'js/large.bin': {'sha256': sha, 'bytes': len(payload)}},
    }))
    monkeypatch.setenv('FRONTEND_DIST', str(tmp_path))
    original = Path.read_bytes

    def guarded(path):
        assert path != file, 'Range serving must not allocate the complete file'
        return original(path)

    monkeypatch.setattr(Path, 'read_bytes', guarded)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=StaticFrontend()), base_url='https://fixture.invalid') as client:
            url = '/assets/1234567890abcdef1234/js/large.bin'
            r = await client.get(url, headers={'Range': 'bytes=0-9', 'Accept-Encoding': 'gzip'})
            assert r.status_code == 206 and r.content == payload[:10]
            assert r.headers['content-range'] == f'bytes 0-9/{len(payload)}'
            assert 'content-encoding' not in r.headers
            r = await client.get(url, headers={'Range': 'bytes=-8'})
            assert r.status_code == 206 and r.content == payload[-8:]
            r = await client.head(url, headers={'Range': 'bytes=2-5'})
            assert r.status_code == 206 and not r.content and r.headers['content-length'] == '4'
            r = await client.get(url, headers={'Range': 'bytes=0-9', 'If-Range': '"old-version"'})
            assert r.status_code == 200 and r.content == payload
            r = await client.get(url, headers={'Range': 'bytes=0-9', 'If-Range': '"' + sha + '"'})
            assert r.status_code == 206 and r.content == payload[:10]
            r = await client.get(url, headers={'Range': f'bytes={len(payload)}-'})
            assert r.status_code == 416

    asyncio.run(run())
