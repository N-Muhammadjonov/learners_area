"""Package reviewed HTML5/CSS3/browser JavaScript using only Python's stdlib."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'frontend/vanilla'
ALLOWED = ('index.html', 'js', 'modules', 'css/global.css', 'css/fonts.css',
           'css/campus.css', 'fonts', 'brand', 'images', 'campus')
EXTENSIONS = {'.html','.js','.mjs','.css','.json','.woff','.woff2','.ttf','.png','.jpg',
              '.jpeg','.webp','.svg','.avif','.ico','.mp4','.webm','.mp3','.ogg','.wav','.m4a'}
FORBIDDEN = {'package.json','package-lock.json','node_modules','scripts','tests','docs'}


def build(base=BASE):
    base=Path(base)
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
        manifest={'version':1,'files':files,'routes':routes['routes'],'redirects':routes['redirects']}
        (temporary/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        target=base/'build'
        if target.exists(): shutil.rmtree(target)
        temporary.rename(target)
    finally:
        if temporary.exists(): shutil.rmtree(temporary)
    return {'staticBuild':True,'runtime':'Python FastAPI','files':len(files),'routes':len(routes['routes']),'nodeRequired':False}


if __name__=='__main__': print(json.dumps(build()))
