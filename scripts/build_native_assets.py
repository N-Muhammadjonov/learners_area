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
           'css/campus.css', 'css/riwi.css', 'css/dock.css', 'fonts', 'brand', 'images', 'campus')
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


def overlay_feature_bundles(temporary, files, base):
    """Overlay verified browser bundles in the static staging tree.

    Source JS files are preserved as fallback for existing workers and URL-based
    imports. Only the built runtime entry is replaced; all other bundled chunks
    load through the ESM graph with independent, immutable asset URLs.
    """
    value = os.getenv('LA_BROWSER_BUNDLES', '').strip()
    if not value:
        return {'enabled': False, 'chunks': 0}
    source = Path(value).resolve()
    if not source.is_dir():
        raise ValueError('Feature bundle directory is unavailable')
    report = source / 'bundle-report.json'
    if not report.is_file():
        raise ValueError('Feature bundle report is unavailable')
    document = json.loads(report.read_text())
    if document.get('version') != 2 or document.get('entry') != 'js/main.js':
        raise ValueError('Invalid feature bundle manifest')
    chunks = document.get('chunks')
    if not isinstance(chunks, list) or len(chunks) < 2:
        raise ValueError('Feature bundles must include entry and lazy chunks')
    # Reject stale output and partial/tampered bundles before replacing the entry.
    sources = document.get('sourceFiles')
    if not isinstance(sources, dict) or not sources:
        raise ValueError('Missing bundle source provenance')
    for name, expected in sources.items():
        candidate = Path(name)
        target = base / candidate
        if (candidate.is_absolute() or '..' in candidate.parts or not target.is_file() or target.is_symlink()
                or not target.resolve().is_relative_to(base.resolve())):
            raise ValueError('Unsafe bundle source: ' + name)
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise ValueError('Stale bundle source: ' + name)
    paths = set()
    for chunk in chunks:
        if not isinstance(chunk, dict) or not isinstance(chunk.get('path'), str):
            raise ValueError('Invalid bundle record')
        name = chunk['path']
        candidate = Path(name)
        if (candidate.is_absolute() or '..' in candidate.parts or
                not name.startswith('js/') or candidate.suffix != '.js' or
                name in paths or any(part.startswith('.') for part in candidate.parts)):
            raise ValueError('Unsafe bundle path: ' + name)
        paths.add(name)
        target = source / candidate
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(source):
            raise ValueError('Missing or unsafe bundle file: ' + name)
        content = target.read_bytes()
        if len(content) != chunk.get('bytes') or not content or hashlib.sha256(content).hexdigest() != chunk.get('sha256'):
            raise ValueError('Invalid bundle byte count: ' + name)
        destination = temporary / candidate
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        files[name] = {'sha256': hashlib.sha256(content).hexdigest(),
                       'bytes': len(content)}
    if 'js/main.js' not in paths:
        raise ValueError('Missing browser bundle entry')
    graph = {chunk['path']: chunk for chunk in chunks}
    visited, active = set(), set()
    def check(name):
        if name in active: raise ValueError('Circular bundle graph: ' + name)
        if name in visited: return
        active.add(name)
        row = graph[name]
        for field in ('imports', 'dynamicImports'):
            if not isinstance(row.get(field), list) or any(dep not in paths for dep in row[field]):
                raise ValueError('Missing bundle dependency: ' + name)
        for dep in row['imports']: check(dep)
        active.remove(name); visited.add(name)
    for name in graph: check(name)
    return {'enabled': True, 'chunks': len(paths)}


def optimize(temporary, files, bundled_paths=frozenset()):
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
            if target.suffix in ('.js','.mjs') and name not in bundled_paths and not name.startswith('campus/') and '`' not in text:
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
    # RIWI's read-only site inventory is a separately generated runtime artifact.
    # Its source hashes are NOT a prerequisite for packaging browser assets.
    # Versioned browser chunks retain independent SHA-256/provenance verification.
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
        feature_bundles = overlay_feature_bundles(temporary, files, base)
        bundled_paths = set()
        if feature_bundles['enabled']:
            report = json.loads((Path(os.environ['LA_BROWSER_BUNDLES'])/'bundle-report.json').read_text())
            bundled_paths = {row['path'] for row in report['chunks']}
        revision,stats=optimize(temporary,files,bundled_paths)
        stats['featureBundles'] = feature_bundles
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
