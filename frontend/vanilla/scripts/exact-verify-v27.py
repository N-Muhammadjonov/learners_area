#!/usr/bin/env python3
"""Exact V27 extraction/verification coordinator. Preview must serve extracted build
on4173 before --run; immutable V26 reference serves4178. No live backend probes."""
import pathlib,zipfile,hashlib,json,subprocess,os,sys,shutil
repo=pathlib.Path(os.environ.get('V27_REPO','/home/user/learners_area'));base=repo/'migration/vanilla-frontend';work=pathlib.Path(os.environ.get('V27_WORK','/home/user/v27-independent'));extract=work/'extracted';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V27.zip';work.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def run(name,args,cwd=extract,env=None):
 with (work/(name+'.txt')).open('w') as log:r=subprocess.run(args,cwd=cwd,env=os.environ|(env or {}),stdout=log,stderr=subprocess.STDOUT)
 state=json.loads((work/'commands.json').read_text()) if (work/'commands.json').exists() else [];state.append({'name':name,'args':args,'exit':r.returncode});(work/'commands.json').write_text(json.dumps(state,indent=2));print(state[-1],flush=True);return r.returncode
if '--extract' in sys.argv:
 assert not extract.exists(),'Refuse overwriting previous extraction'
 extract.mkdir();data=archive.read_bytes();members=[]
 with zipfile.ZipFile(archive) as z:
  assert len(z.namelist())==len(set(z.namelist()));assert z.testzip() is None
  for n in z.namelist():assert not pathlib.PurePosixPath(n).is_absolute() and '..' not in pathlib.PurePosixPath(n).parts
  expected=dict(line.split('  ',1)[::-1] for line in z.read('SHA256SUMS').decode().splitlines())
  assert set(z.namelist())==set(expected)|{'SHA256SUMS','docs/FILE_MANIFEST.md'}
  for name,digest in expected.items():assert sha(z.read(name))==digest;members.append({'path':name,'sha256':digest})
  z.extractall(extract)
 (work/'extraction.json').write_text(json.dumps({'archiveSHA256':sha(data),'archiveBytes':len(data),'members':members,'CRC':'PASS','safeUniqueMembers':True},indent=2))
 assert run('npm-ci',['npm','ci'])==0;assert run('build',['npm','run','build'])==0
elif '--run' in sys.argv:
 original={'ORIGINAL_SOURCE_ROOT':str(repo),'V27_SOURCE':'1'}|{f'V{i}_SOURCE':'1' for i in range(12,27)}
 run('unit',['npm','test']);run('chromium',['node','scripts/regression-v27.mjs']);run('source',['node','tests/browser-original-source-v11.mjs'],env=original)
 p=extract/'docs/evidence/v27/original-behavior-v27.json'
 if p.exists():shutil.copy2(p,work/'original-source-full.json')
 run('extension',['python3','scripts/verify-extension-v27.py'],env={'ORIGINAL_SOURCE_ROOT':str(repo)})
 run('audit-runtime',['npm','audit','--omit=dev','--json']);run('audit-all',['npm','audit','--json'])
 shutil.copytree(extract/'docs/evidence/v27',work/'executed-evidence',dirs_exist_ok=True)
 print('All requested commands completed; command failures remain recorded.',flush=True)
else:raise SystemExit('Specify --extract or --run')
