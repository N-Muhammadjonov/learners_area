"""A deployment can package the site with no Node/npm binaries on PATH."""
import importlib.util
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('native_builder',ROOT/'scripts/build_native_assets.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


def fixture(tmp_path):
    for name in ('index.html','js/main.js','js/generated/view-registry.js','css/global.css'):
        p=tmp_path/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('')
    (tmp_path/'routes.json').write_text(json.dumps({'version':1,'routes':['/app'],'redirects':[]}))
    return tmp_path


def test_stale_riwi_snapshot_does_not_block_browser_packaging(tmp_path, monkeypatch):
    base = fixture(tmp_path / 'frontend' / 'vanilla')
    catalog = tmp_path / 'services' / 'backend' / 'app' / 'data' / 'riwi_site_catalog.json'
    catalog.parent.mkdir(parents=True)
    catalog.write_text(json.dumps({'version': 1, 'routes': [], 'sources': {
        'frontend/vanilla/js/main.js': '0' * 64
    }}))
    monkeypatch.setattr(builder, 'ROOT', tmp_path)
    monkeypatch.setattr(builder, 'BASE', base)
    result = builder.build(base)
    assert result['staticBuild'] is True
    assert (base / 'build' / 'asset-manifest.json').is_file()


def test_build_excludes_symlinks_and_rejects_framework_import(tmp_path):
    base=fixture(tmp_path)
    outside=tmp_path/'secret';outside.write_text('secret')
    (base/'js/secret.js').symlink_to(outside)
    builder.build(base)
    assert not (base/'build/js/secret.js').exists()
    (base/'js/main.js').write_text("import {x} from 'next/navigation';")
    with pytest.raises(ValueError,match='Server/framework dependency'):builder.build(base)


def copy_docker_stage(stage: str, target_root: Path, assets_root: Path) -> None:
    for line in stage.splitlines():
        if not line.startswith('COPY '):
            continue
        parts = line.split()[1:]
        if parts[0] == '--from=browser-bundler':
            _, source, destination = parts
            source_path = ROOT / Path(source).relative_to('/build')
        elif parts[0] == '--from=assets':
            _, source, destination = parts
            source_path = assets_root / Path(source).relative_to('/build')
        else:
            source, destination = parts
            source_path = ROOT / source
        target = target_root / destination
        if source_path.is_dir():
            ignore = shutil.ignore_patterns('build', '__pycache__') if source_path == ROOT / 'frontend/vanilla' else shutil.ignore_patterns('__pycache__')
            shutil.copytree(source_path, target, ignore=ignore)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_path, target)


@pytest.mark.parametrize('docker_assets', [False, True], ids=['checkout', 'docker-assets-stage'])
def test_real_build_without_node(tmp_path, docker_assets):
    root = ROOT
    if docker_assets:
        root = tmp_path / 'assets'
        dockerfile = (ROOT / 'services/backend/Dockerfile').read_text()
        stages = re.split(r'(?m)(?=^FROM )', dockerfile)
        assets_stage = next(stage for stage in stages if stage.startswith('FROM python:') and ' AS assets\n' in stage)
        runtime_stage = next(stage for stage in stages if stage.startswith('FROM python:') and ' AS assets\n' not in stage)
        # The Node stage runs first, then Python packaging/runtime must work with
        # Node absent from PATH, just as in the actual multi-stage image.
        subprocess.run(['node', str(ROOT/'scripts/bundle_browser.mjs')], cwd=ROOT, check=True, capture_output=True)
        copy_docker_stage(assets_stage, root, root)
        catalog = root / 'services/backend/app/data/riwi_site_catalog.json'
        subprocess.run(['node', str(ROOT / 'scripts/riwi-site-catalog.mjs'),
                        '--output', str(catalog)], cwd=ROOT, check=True, capture_output=True)
        generated = json.loads(catalog.read_text())
        assert all(hashlib.sha256((root / path).read_bytes()).hexdigest() == expected
                   for path, expected in generated['sources'].items())
    env = {'PATH': '/nonexistent', 'PYTHONPATH': os.pathsep.join(str(Path(item).resolve()) for item in sys.path if item)}
    if docker_assets:
        env['LA_BROWSER_BUNDLES'] = str(root/'bundle-output')
    result = subprocess.run([sys.executable, str(root / 'scripts/build_native_assets.py')],
                            cwd=root, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary['nodeRequired'] is False and summary['routes'] > 100
    if docker_assets:
        assert summary['featureBundles']['enabled'] is True
    manifest = json.loads((root / 'frontend/vanilla/build/asset-manifest.json').read_text())
    assert all(not name.startswith(('src/', 'node_modules/')) for name in manifest['files'])
    if docker_assets:
        runtime = tmp_path / 'runtime'
        copy_docker_stage(runtime_stage, runtime, root)
        result = subprocess.run([sys.executable, str(runtime / 'scripts/serve.py'), '--check'],
                                cwd=runtime, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr


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


def test_cdn_model_parts_exist_in_the_git_input_before_the_build_command_runs():
    # Vercel's static collector must see public inputs before our Python build.
    # Byte-identical Git blobs are shared with the pinned browser source parts.
    manifest=json.loads((ROOT/'frontend/vanilla/js/vendor/riwi-speech/manifest.json').read_text())
    tracked=set(subprocess.check_output(['git','ls-files','public/riwi-speech-assets/parts'],cwd=ROOT,text=True).splitlines())
    expected={}
    for asset in manifest['assets'].values():
        for part in asset['parts']:expected['public/riwi-speech-assets/'+part['path']]=part
    assert tracked==set(expected)
    for name,part in expected.items():
        raw=(ROOT/name).read_bytes()
        assert len(raw)==part['bytes']
        assert hashlib.sha256(raw).hexdigest()==part['sha256']
