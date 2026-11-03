"""A deployment can package the site with no Node/npm binaries on PATH."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('native_builder',ROOT/'scripts/build_native_assets.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


def fixture(tmp_path):
    for name in ('index.html','js/main.js','js/generated/view-registry.js','css/global.css'):
        p=tmp_path/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('')
    (tmp_path/'routes.json').write_text(json.dumps({'version':1,'routes':['/app'],'redirects':[]}))
    return tmp_path


def test_build_excludes_symlinks_and_rejects_framework_import(tmp_path):
    import pytest
    base=fixture(tmp_path)
    outside=tmp_path/'secret';outside.write_text('secret')
    (base/'js/secret.js').symlink_to(outside)
    builder.build(base)
    assert not (base/'build/js/secret.js').exists()
    (base/'js/main.js').write_text("import {x} from 'next/navigation';")
    with pytest.raises(ValueError,match='Server/framework dependency'):builder.build(base)


def test_real_build_without_node(monkeypatch):
    result=subprocess.run([sys.executable,str(ROOT/'scripts/build_native_assets.py')],cwd=ROOT,env={'PATH':'/nonexistent','PYTHONPATH':os.pathsep.join(str(Path(item).resolve()) for item in sys.path if item)},check=True,capture_output=True,text=True)
    summary=json.loads(result.stdout)
    assert summary['nodeRequired'] is False and summary['routes']>100
    manifest=json.loads((ROOT/'frontend/vanilla/build/asset-manifest.json').read_text())
    assert all(not name.startswith(('src/','node_modules/')) for name in manifest['files'])


def test_speech_parts_are_copied_to_cdn_without_publishing_private_or_non_model_files(tmp_path):
    build_root=tmp_path/'build';source=build_root/'js/vendor/riwi-speech/parts';source.mkdir(parents=True)
    name='a'*16+'-000.bin';(source/name).write_bytes(b'public model fixture')
    (source/'private.txt').write_text('never publish')
    result=builder.publish_speech_parts(build_root,tmp_path/'public')
    public=tmp_path/'public/riwi-speech-assets/parts'
    assert sorted(p.name for p in public.iterdir())==[name]
    assert (public/name).read_bytes()==(source/name).read_bytes()
    assert result['cdnSpeechFiles']==1
    config=json.loads((ROOT/'vercel.json').read_text())
    assert 'build/**/parts' in config['functions']['server.py']['excludeFiles']
    assert len(config['functions']['server.py']['excludeFiles'])<=256
