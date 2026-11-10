"""Vendor a pinned, public ASR model/runtime for browser-only dictation.

Public weights are split into 2 MiB responses for the existing Python asset
server. Audio is never an input to this build script or any remote API.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
TARGET=ROOT/'frontend/vanilla/js/vendor/riwi-speech'
CHUNK=2*1024*1024
MODEL='onnx-community/whisper-base'
FILES=['config.json','generation_config.json','preprocessor_config.json','tokenizer.json','tokenizer_config.json',
       'onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx']


def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'RIWI-public-ASR-assets/1'})
    with urllib.request.urlopen(req,timeout=120) as response:return response.read()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package-root',type=Path,required=True)
    p.add_argument('--revision')
    args=p.parse_args()
    package=args.package_root/'@huggingface/transformers'
    info=json.loads((package/'package.json').read_text())
    if info['version']!='3.8.1':raise ValueError('Expected Transformers.js 3.8.1')
    api=json.loads(get('https://huggingface.co/api/models/'+MODEL+'?blobs=true'))
    saved=TARGET/'manifest.json'
    prior=json.loads(saved.read_text()) if saved.exists() else {}
    revision=args.revision or prior.get('modelRevision') or api['sha']
    if revision!=api['sha']:api=json.loads(get('https://huggingface.co/api/models/'+MODEL+'/revision/'+revision+'?blobs=true'))
    listed={row['rfilename']:row for row in api['siblings']}
    TARGET.mkdir(parents=True,exist_ok=True);(TARGET/'parts').mkdir(exist_ok=True)
    assets={};used=set()
    def split(name,data,mime,source):
        sha=hashlib.sha256(data).hexdigest();parts=[]
        for offset in range(0,len(data),CHUNK):
            raw=data[offset:offset+CHUNK];part='parts/'+sha[:16]+'-'+str(offset//CHUNK).zfill(3)+'.bin'
            (TARGET/part).write_bytes(raw);used.add(part)
            parts.append({'path':part,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
        assets[name]={'bytes':len(data),'sha256':sha,'mime':mime,'parts':parts,'source':source}
    for name in FILES:
        source='https://huggingface.co/'+MODEL+'/resolve/'+revision+'/'+name
        row=listed[name];expected=row.get('lfs',{}).get('sha256');data=None
        if expected:
            cached=sorted((TARGET/'parts').glob(expected[:16]+'-*.bin'))
            if cached:
                joined=b''.join(p.read_bytes() for p in cached)
                if hashlib.sha256(joined).hexdigest()==expected:data=joined
        if data is None:data=get(source)
        if expected and hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Model hash mismatch: '+name)
        split('models/riwi-asr/'+name,data,'application/json' if name.endswith('.json') else 'application/octet-stream',source)
        print(json.dumps({'file':name,'bytes':len(data)}),flush=True)
    for name in ('transformers.min.js','ort-wasm-simd-threaded.jsep.mjs'):
        shutil.copyfile(package/'dist'/name,TARGET/name)
    wasm=package/'dist/ort-wasm-simd-threaded.jsep.wasm'
    split(wasm.name,wasm.read_bytes(),'application/wasm','npm:@huggingface/transformers@3.8.1/dist/'+wasm.name)
    shutil.copyfile(package/'LICENSE',TARGET/'LICENSE.transformers')
    ort_revision=(args.package_root/'onnxruntime-web/__commit.txt').read_text().strip()
    (TARGET/'LICENSE.onnxruntime').write_bytes(get('https://raw.githubusercontent.com/microsoft/onnxruntime/'+ort_revision+'/LICENSE'))
    (TARGET/'LICENSE.model').write_bytes(get('https://www.apache.org/licenses/LICENSE-2.0.txt'))
    upstream=json.loads(get('https://api.github.com/repos/openai/whisper/commits/main'))['sha']
    (TARGET/'LICENSE.upstream').write_bytes(get('https://raw.githubusercontent.com/openai/whisper/'+upstream+'/LICENSE'))
    manifest={'version':1,'partsBase':'/riwi-speech-assets/','runtimeVersion':info['version'],'model':MODEL,'modelRevision':revision,
        'upstreamLicenseRevision':upstream,'ortRevision':ort_revision,'modelLicense':api.get('cardData',{}).get('license'),
        'totalBinaryBytes':sum(row['bytes'] for row in assets.values()),'assets':assets,
        'runtimeHashes':{name:hashlib.sha256((TARGET/name).read_bytes()).hexdigest() for name in ('transformers.min.js','ort-wasm-simd-threaded.jsep.mjs')}}
    saved.write_text(json.dumps(manifest,indent=2)+'\n')
    for file in (TARGET/'parts').glob('*.bin'):
        if file.relative_to(TARGET).as_posix() not in used:file.unlink()
    print(json.dumps({'revision':revision,'totalBytes':manifest['totalBinaryBytes'],'parts':len(used)}))


if __name__=='__main__':main()
