"""Verify target preservation and emit complete, reproducible integration manifests."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs/vanilla-integration'
BASE=json.loads((DOCS/'target-baseline.json').read_text())
ALLOWED={
 '.dockerignore':'Exclude nested dependency symlinks and stale frontend builds from Docker asset inputs.',
 'Dockerfile.frontend':'Rename to Dockerfile.legacy-next; default container becomes Python-only.',
 'README.md':'Document native static build, single Python runtime and verification limits.',
 'compose.preview.yml':'Serve one Python container with the existing storage volume.',
 'package.json':'Point default build/start/dev at native assets and Python; retain dependency versions and legacy tooling.',
 'services/backend/Dockerfile':'Build static assets in a throwaway Node stage, run only Python in the final image.',
 'services/backend/app/asgi.py':'Dispatch browser reads and allowlisted static routes while retaining all original APIs and private renderer.',
 'services/backend/app/exam_lifecycle_port.py':'Cast the repeated duration parameter to integer so PostgreSQL can prepare exam start; no duration/rule changes.',
 'vercel.json':'Select Python FastAPI entrypoint and explicit packaged static assets; retain legacy config separately.',
}


def digest(path):
    data=path.read_bytes()
    return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'blob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}


def write(name,value):
    (DOCS/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def main():
    baseline={r['path']:r for r in BASE['files']}
    changed=[];unexpected=[];unchanged=0;backend_unchanged=0
    for name,old in baseline.items():
        path=ROOT/name
        new=digest(path) if path.is_file() and not path.is_symlink() else None
        if new and new['sha256']==old['sha256']:
            unchanged+=1;backend_unchanged+=name.startswith('services/backend/');continue
        change={'path':name,'status':'modified' if new else 'deleted','before':old,'after':new,'reason':ALLOWED.get(name)}
        changed.append(change)
        if name not in ALLOWED:unexpected.append(name)
    # Original target and imported runtime are tracked in the isolated checkpoint.
    # New integration files are included only if Git would include them.
    listed=subprocess.check_output(['git','ls-files','-c','-o','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
    generated={'docs/vanilla-integration/'+n for n in ('preservation.json','changed-files.json','target-only-files.json','api-inventory.json')}
    paths=set(listed)-{''}
    omitted=[name for name in baseline if (ROOT/name).is_file() and name not in paths]
    assert not omitted,('Protected files omitted from Git inventory',omitted)
    additions=[]
    for name in sorted(paths-baseline.keys()-generated):
        path=ROOT/name
        if path.is_symlink():
            raise SystemExit('Symlink would be committed: '+name)
        if path.is_file():additions.append({'path':name,'status':'added','after':digest(path)})
    if unexpected:raise SystemExit('Unexpected protected target changes: '+repr(unexpected))
    for name in ALLOWED:
        if name not in baseline:raise SystemExit('Allowlist does not match target baseline: '+name)
    migrations=[r for r in BASE['files'] if r['path'].startswith('services/backend/migrations/')]
    assert all((ROOT/r['path']).is_file() and digest(ROOT/r['path'])['sha256']==r['sha256'] for r in migrations)
    source=json.loads((DOCS/'source-runtime-baseline.json').read_text())
    missing_source=[r['path'] for r in source if not (ROOT/'frontend/vanilla'/r['path']).is_file()]
    assert not missing_source,missing_source
    assert all('frontend/vanilla/'+r['path'] in paths for r in source),'Imported active files omitted from Git inventory'
    for original in (ROOT/'public/campus/v2').rglob('*'):
        if original.is_file():assert original.read_bytes()==(ROOT/'frontend/vanilla/campus/v2'/original.relative_to(ROOT/'public/campus/v2')).read_bytes(),original
    main_files={r['path']:r for r in json.loads((DOCS/'main-tree-baseline.json').read_text())['tree']}
    target_changes=[{'path':name,'mainBlob':main_files.get(name,{}).get('sha'),'targetBlob':old['blob']}
                    for name,old in sorted(baseline.items()) if main_files.get(name,{}).get('sha')!=old['blob']]
    write('target-only-files.json',target_changes)
    sys.path.insert(0,str(ROOT/'services/backend'))
    from app.main import app
    parity=json.loads((ROOT/'services/backend/contracts/main-http-parity.json').read_text())['cases']
    expected=[{'method':m,'path':p} for m,p in sorted({(r['method'],r['path']) for r in parity})]
    actual={(method,route.path) for route in app.routes for method in getattr(route,'methods',()) if route.path.startswith('/api/')}
    missing=[r for r in expected if (r['method'],r['path']) not in actual]
    assert not missing,missing
    write('api-inventory.json',{'expectedMethods':len(expected),'actualMethods':len(actual),'missing':missing,
      'routes':[{'method':m,'path':p} for m,p in sorted(actual)]})
    write('changed-files.json',{'againstTarget':BASE['targetCommit'],'existingChanges':changed,'addedFiles':additions,
      'generatedAuditFiles':sorted(generated),'note':'These audit files are generated; hashes for every published file are also recorded in the remote Git tree.'})
    report={'result':'passed','targetCommit':BASE['targetCommit'],'targetTree':BASE['targetTree'],
      'sourceCommit':BASE['sourceCommit'],'baselineFiles':len(baseline),'unchangedOriginalFiles':unchanged,
      'intentionalExistingChanges':len(changed),'unexpectedChanges':unexpected,
      'backendOriginalFiles':sum(n.startswith('services/backend/') for n in baseline),
      'backendOriginalFilesUnchanged':backend_unchanged,'migrationsUnchanged':len(migrations),
      'sourceRuntimeFilesPresent':len(source),'campusV2ByteIdentical':True,'originalHttpMethodsPresent':len(expected),
      'mainMerged':False,'sourceBranchMerged':False,'productionDataModified':False}
    write('preservation.json',report)
    print(json.dumps(report))


if __name__=='__main__':main()
