"""Shipped main assets are complete, bounded and checksum verified."""
from pathlib import Path
import hashlib,json,gzip
import pytest
from app import main
from app.listening_runtime import manifest,runtime,ROOT
from app.dictionary_presentation import manifest as presentation_manifest,ROOT as PRESENTATION


@pytest.mark.parametrize('number',range(1,33))
def test_all_original_listening_runtimes_are_shipped(number):
    value=runtime(number)
    assert value['entryPath']=='source.html'
    html=value['files']['source.html']
    assert 'originalSaveStored' in html and 'laCourseWork' in html
    assert manifest()['sourceCommit']=='b62b78f469e4f73aa80f441f630b012dc422af39'


@pytest.mark.parametrize('prefix',[f'{i:02x}' for i in range(256)])
def test_dictionary_presentation_shards_match_main(prefix):
    descriptor=presentation_manifest()['shards'][prefix]
    body=(PRESENTATION/(prefix+'.json.gz')).read_bytes()
    assert len(body)==descriptor['bytes']
    assert hashlib.sha256(body).hexdigest()==descriptor['sha256']
    raw=gzip.decompress(body)
    assert len(raw)<=4*1024*1024 and isinstance(json.loads(raw),dict)
