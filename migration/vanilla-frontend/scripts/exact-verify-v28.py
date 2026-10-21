#!/usr/bin/env python3
"""Exact source verifier; retains every command status and restores sealed evidence.
No variant-extension rerun; no retries; full baseline assertions unchanged."""
import pathlib,zipfile,hashlib,json,subprocess,os,sys,shutil
repo=pathlib.Path('/home/user/learners_area');base=repo/'migration/vanilla-frontend';work=pathlib.Path('/home/user/v28-independent');extract=work/'extracted';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V28.zip';work.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def run(name,args,env=None):
 with (work/(name+'.txt')).open('w') as log:r=subprocess.run(args,cwd=extract,env=os.environ|(env or {}),stdout=log,stderr=subprocess.STDOUT)
 state=json.loads((work/'commands.json').read_text()) if (work/'commands.json').exists() else [];state.append({'name':name,'args':args,'exit':r.returncode});(work/'commands.json').write_text(json.dumps(state,indent=2));print(state[-1],flush=True);return r.returncode
if '--extract' in sys.argv:
 assert not extract.exists();extract.mkdir();members=[]
 with zipfile.ZipFile(archive) as z:
  assert len(z.namelist())==len(set(z.namelist())) and z.testzip() is None
  expected=dict(line.split('  ',1)[::-1] for line in z.read('SHA256SUMS').decode().splitlines());assert set(z.namelist())==set(expected)|{'SHA256SUMS','docs/FILE_MANIFEST.md'}
  for name in z.namelist():
   assert not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts
   digest=sha(z.read(name));assert name not in expected or digest==expected[name];members.append({'path':name,'sha256':digest})
  z.extractall(extract)
 (work/'extraction.json').write_text(json.dumps({'archiveSHA256':sha(archive.read_bytes()),'archiveBytes':archive.stat().st_size,'members':members,'CRC':'PASS','safeUniqueMembers':True},indent=2))
 assert run('npm-ci',['npm','ci'])==0;assert run('build',['npm','run','build'])==0
elif '--run' in sys.argv:
 saved={p:p.read_bytes() for p in (extract/'docs/evidence').rglob('*') if p.is_file()};original={'ORIGINAL_SOURCE_ROOT':str(repo),'V27_SOURCE':'1'}|{f'V{i}_SOURCE':'1' for i in range(12,27)}
 try:
  run('unit',['npm','test']);run('chromium',['node','scripts/regression-v28.mjs']);run('source',['node','tests/browser-original-source-v11.mjs'],original)
  shutil.copy2(extract/'docs/evidence/v27/original-behavior-v27.json',work/'original-source-full.json')
  run('timing',['node','scripts/performance-v28.mjs']);run('assets',['node','scripts/assets-css-v28.mjs'])
  for version,port in [('V27',4178),('V28',4173)]:
   run('controls-'+version,['node','tests/browser-original-source-v11.mjs'],{'ORIGINAL_SOURCE_ROOT':str(repo),'V22_SOURCE':'1','V22_BENCH':'1','TEST_FILTER':'V22 controlled','PREVIEW_URL':'http://127.0.0.1:'+str(port)})
   d=work/'performance'/version;d.mkdir(parents=True,exist_ok=True)
   for p in (extract/'docs/evidence/v22').glob('controlled*.json'):shutil.copy2(p,d/p.name)
   shutil.copy2(extract/'docs/evidence/v22/original-behavior-v22.json',d/'cases.json')
  run('resources',['node','tests/browser-original-source-v11.mjs'],{'V28_DIAGNOSTIC':'1','TEST_FILTER':'V28 diagnostic','ORIGINAL_SOURCE_ROOT':str(repo)})
  shutil.copytree(extract/'docs/evidence/v28',work/'executed-evidence')
  run('audit-runtime',['npm','audit','--omit=dev','--json']);run('audit-all',['npm','audit','--json'])
 finally:
  for p,b in saved.items():p.write_bytes(b)
  for p in (extract/'docs/evidence').rglob('*'):
   if p.is_file() and p not in saved:p.unlink()
 print('Completed all commands, with failures retained. Audit-all is separate from case outcomes.',flush=True)
else:raise SystemExit('Use --extract or --run')
