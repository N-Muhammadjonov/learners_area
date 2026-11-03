"""Package versioned browser assets with Python-only build/runtime dependencies."""
from __future__ import annotations
import hashlib
import gzip
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'frontend/vanilla'
ALLOWED = ('index.html', 'js', 'modules', 'css/global.css', 'css/fonts.css',
           'css/campus.css', 'css/riwi.css', 'fonts', 'brand', 'images', 'campus')
EXTENSIONS = {'.html','.js','.mjs','.css','.json','.woff','.woff2','.ttf','.png','.jpg',
              '.wasm','.bin','.gz','.bcmap','.pfb','.jpeg','.webp','.svg','.avif','.ico','.mp4','.webm','.mp3','.ogg','.wav','.m4a'}
FORBIDDEN = {'package.json','package-lock.json','node_modules','scripts','tests','docs'}


def publish_speech_parts(build_root,public_root):
    """Public model bytes belong on the CDN, outside the Python function bundle."""
    source=Path(build_root)/'js/vendor/riwi-speech/parts'
    if not source.is_dir(): return {'cdnSpeechBytes':0,'cdnSpeechFiles':0}
    destination=Path(public_root)/'riwi-speech-assets'
    if destination.exists(): shutil.rmtree(destination)
    target=destination/'parts';target.mkdir(parents=True)
    total=count=0
    for part in sorted(source.glob('*.bin')):
        if not re.fullmatch(r'[a-f0-9]{16}-\d{3}\.bin',part.name) or part.is_symlink(): raise ValueError('Invalid speech part')
        shutil.copyfile(part,target/part.name);total+=part.stat().st_size;count+=1
    return {'cdnSpeechBytes':total,'cdnSpeechFiles':count}


def optimize(temporary, files):
    from rcssmin import cssmin
    from rjsmin import jsmin
    # The revision names the whole ESM graph, including dynamically loaded children.
    signature={'files':files,'builder':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'rjsmin':version('rjsmin'),'rcssmin':version('rcssmin')}
    revision = hashlib.sha256(json.dumps(signature,sort_keys=True).encode()).hexdigest()[:20]
    prefix = '/assets/' + revision
    original = sum(row['bytes'] for row in files.values())
    compressed = 0
    minified = 0
    for name, row in files.items():
        target = temporary / name
        content = target.read_bytes()
        if target.suffix in ('.js','.mjs','.css','.html'):
            text = content.decode('utf-8')
            if target.suffix in ('.js','.mjs') and not name.startswith('campus/') and '`' not in text:
                # rJSmin's documented template support is deliberately not used on
                # template-bearing modules. Keep all templates exactly as authored.
                text = jsmin(text,keep_bang_comments=True);minified += 1
            elif target.suffix == '.css':
                text = cssmin(text,keep_bang_comments=True);minified += 1
            # Only literal public runtime prefixes change. API/Worker URLs never do.
            text = re.sub(r'''(["'`])/(js|modules|css|fonts|brand|images|campus)/''',
                lambda match: match[1]+prefix+'/'+match[2]+'/',text)
            if name == 'index.html':
                text = text.replace('<head>', '<head>\n<meta name="la-build" content="'+revision+'">')
            content = text.encode('utf-8');target.write_bytes(content)
        row.update(sha256=hashlib.sha256(content).hexdigest(),bytes=len(content))
        if name != 'index.html' and target.suffix in ('.js','.mjs','.css','.svg','.json') and len(content)>=256:
            packed=gzip.compress(content,compresslevel=9,mtime=0)
            if len(packed)<len(content)*.9:
                packed_name='.gzip/'+name+'.gz'
                packed_path=temporary/packed_name;packed_path.parent.mkdir(parents=True,exist_ok=True);packed_path.write_bytes(packed)
                row['gzip']=packed_name;row['gzipBytes']=len(packed);row['gzipSha256']=hashlib.sha256(packed).hexdigest();compressed += len(packed)
                continue
        compressed += len(content)
    return revision,{'inputBytes':original,'transferBytes':compressed,'minifiedFiles':minified}


def build(base=BASE):
    base=Path(base)
    if base.resolve() == BASE.resolve():
        catalogue=ROOT/'services/backend/app/data/riwi_site_catalog.json'
        for source, expected in json.loads(catalogue.read_text())['sources'].items():
            path=ROOT/source
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
                raise ValueError('Stale RIWI site catalogue; run node scripts/riwi-site-catalog.mjs: '+source)
    for required in ('index.html','js/main.js','js/generated/view-registry.js','css/global.css','routes.json'):
        if not (base/required).is_file(): raise ValueError('Missing frontend input: '+required)
    routes=json.loads((base/'routes.json').read_text())
    if routes.get('version')!=1 or not routes.get('routes'): raise ValueError('Invalid route catalogue')
    for pattern in routes['routes']: re.compile(pattern)
    files={}
    temporary=Path(tempfile.mkdtemp(prefix='.build-',dir=base))
    try:
        for name in ALLOWED:
            source=base/name
            if not source.exists(): continue
            for file in sorted(source.rglob('*')) if source.is_dir() else [source]:
                relative=file.relative_to(base)
                if any((base/Path(*relative.parts[:i])).is_symlink() for i in range(1,len(relative.parts)+1)): continue
                if not file.is_file(): continue
                if any(part.startswith('.') or part in FORBIDDEN for part in relative.parts):
                    raise ValueError('Non-runtime path in build: '+str(relative))
                if file.suffix.lower() not in EXTENSIONS and not re.fullmatch(r'LICENSE(?:\.[a-z]+)?',file.name,re.I): continue
                if file.suffix.lower() in {'.js','.mjs'} and re.search(r'''(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:|next(?:/|['"])|react(?:/|['"]))''',file.read_text()):
                    raise ValueError('Server/framework dependency in browser asset: '+str(relative))
                target=temporary/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
                content=target.read_bytes();files[relative.as_posix()]={'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}
        revision,stats=optimize(temporary,files)
        manifest={'version':1,'revision':revision,'files':files,'routes':routes['routes'],'redirects':routes['redirects'],'optimization':stats}
        (temporary/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        target=base/'build'
        if target.exists(): shutil.rmtree(target)
        temporary.rename(target)
        if base.resolve()==BASE.resolve():
            stats.update(publish_speech_parts(target,ROOT/'public'))
            if os.environ.get('VERCEL')=='1':
                # Keep the function comfortably below the observed 225 MiB limit,
                # even if its bundler changes include/exclude glob precedence.
                shutil.rmtree(target/'js/vendor/riwi-speech/parts',ignore_errors=True)
    finally:
        if temporary.exists(): shutil.rmtree(temporary)
    return {'staticBuild':True,'runtime':'Python FastAPI','files':len(files),'routes':len(routes['routes']),'nodeRequired':False,'revision':revision,**stats}


if __name__=='__main__': print(json.dumps(build()))
