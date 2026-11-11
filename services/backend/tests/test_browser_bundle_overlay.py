"""Fail closed on stale, tampered, missing and cyclic build output."""
import hashlib
import importlib.util
import json
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('bundle_overlay',ROOT/'scripts/build_native_assets.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

def fixture(tmp_path,monkeypatch):
    base=tmp_path/'source';source=tmp_path/'bundles';stage=tmp_path/'stage'
    for path in (base/'js',source/'js',stage):path.mkdir(parents=True)
    content=b'export const value=1;';(base/'js/main.js').write_bytes(content)
    chunks=[]
    for name in ('js/main.js','js/feature.js'):
        (source/name).write_bytes(content)
        chunks.append({'path':name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),
                       'imports':[],'dynamicImports':['js/feature.js'] if name=='js/main.js' else []})
    report={'version':2,'entry':'js/main.js','sourceFiles':{'js/main.js':hashlib.sha256(content).hexdigest()},'chunks':chunks}
    def save():(source/'bundle-report.json').write_text(json.dumps(report))
    save();monkeypatch.setenv('LA_BROWSER_BUNDLES',str(source))
    return base,source,stage,report,save

def test_valid_overlay_and_source_provenance(tmp_path,monkeypatch):
    base,source,stage,report,save=fixture(tmp_path,monkeypatch);files={}
    assert builder.overlay_feature_bundles(stage,files,base)=={'enabled':True,'chunks':2}
    assert set(files)=={'js/main.js','js/feature.js'}
    (base/'js/main.js').write_text('changed')
    with pytest.raises(ValueError,match='Stale bundle source'):builder.overlay_feature_bundles(stage,{},base)

@pytest.mark.parametrize('case',['hash','missing','cycle','traversal','duplicate','symlink'])
def test_invalid_overlay_fails_before_publication(tmp_path,monkeypatch,case):
    base,source,stage,report,save=fixture(tmp_path,monkeypatch)
    if case=='hash':(source/'js/main.js').write_text('export const value=2;')
    elif case=='missing':report['chunks'][0]['dynamicImports']=['js/absent.js']
    elif case=='cycle':
        report['chunks'][0]['imports']=['js/feature.js'];report['chunks'][1]['imports']=['js/main.js']
    elif case=='traversal':report['chunks'][1]['path']='js/../../outside.js'
    elif case=='duplicate':report['chunks'][1]=report['chunks'][0]
    elif case=='symlink':
        (source/'js/feature.js').unlink();(source/'js/feature.js').symlink_to(source/'js/main.js')
    save()
    with pytest.raises(ValueError):builder.overlay_feature_bundles(stage,{},base)
    assert not (base/'build').exists()
