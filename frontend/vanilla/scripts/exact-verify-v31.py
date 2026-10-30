#!/usr/bin/env python3
"""Exact-ZIP verifier. No retries or rerun of the twelve-run diagnostic series.
Run --extract, start extracted preview 4173 and sealed V30 reference 4178, then --run.
Identities must be recorded externally before extraction. Reports retain every exit.
"""
import pathlib,zipfile,hashlib,json,subprocess,os,sys,shutil
repo=pathlib.Path('/home/user/learners_area');base=repo/'migration/vanilla-frontend';work=pathlib.Path('/home/user/v31-independent');extract=work/'extracted';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V31.zip';work.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def run(name,args,cwd=extract,env=None):
 with (work/(name+'.txt')).open('w') as log:r=subprocess.run(args,cwd=cwd,env=os.environ|(env or {}),stdout=log,stderr=subprocess.STDOUT)
 p=work/'commands.json';state=json.loads(p.read_text()) if p.exists() else [];state.append({'name':name,'args':args,'cwd':str(cwd),'exit':r.returncode});p.write_text(json.dumps(state,indent=2));print(state[-1],flush=True);return r.returncode
if '--extract' in sys.argv:
 assert not extract.exists();extract.mkdir();members=[];ids=json.loads((work/'identities.json').read_text())
 with zipfile.ZipFile(archive) as z:
  assert len(z.namelist())==len(set(z.namelist())) and z.testzip() is None
  expected=dict(line.split('  ',1)[::-1] for line in z.read('SHA256SUMS').decode().splitlines());assert set(z.namelist())==set(expected)|{'SHA256SUMS','docs/FILE_MANIFEST.md'}
  for info in z.infolist():
   name=info.filename;assert not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts and not '\\' in name and info.external_attr>>16==0o100644
   data=z.read(name);digest=sha(data);assert name not in expected or digest==expected[name]
   commit=ids['sealCommit'] if name in ['SHA256SUMS','docs/FILE_MANIFEST.md'] else ids['sourceCommit'];gitBytes=subprocess.check_output(['git','-C',str(repo),'show',commit+':migration/vanilla-frontend/'+name]);assert gitBytes==data,name;members.append({'path':name,'sha256':digest})
  z.extractall(extract)
 (work/'extraction.json').write_text(json.dumps({'archiveSHA256':sha(archive.read_bytes()),'archiveBytes':archive.stat().st_size,'members':members,'CRC':'PASS','safeUniqueMembers':'PASS','everyMemberGitIdentity':'PASS'},indent=2))
 assert run('npm-ci',['npm','ci'])==0;assert run('build',['npm','run','build'])==0
 reference=work/'reference-v30';assert not reference.exists();reference.mkdir()
 with zipfile.ZipFile(base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V30.zip') as z:assert z.testzip() is None;z.extractall(reference)
 assert run('reference-npm-ci',['npm','ci'],cwd=reference)==0;assert run('reference-build',['npm','run','build'],cwd=reference)==0
elif '--run' in sys.argv:
 saved={p:p.read_bytes() for p in (extract/'docs/evidence').rglob('*') if p.is_file()};original={'ORIGINAL_SOURCE_ROOT':str(repo),'V27_SOURCE':'1'}|{f'V{i}_SOURCE':'1' for i in range(12,27)}
 try:
  run('unit',['npm','test']);run('chromium',['node','scripts/regression-v31.mjs']);run('source',['node','tests/browser-original-source-v11.mjs'],env=original);shutil.copy2(extract/'docs/evidence/v27/original-behavior-v27.json',work/'original-source-full.json')
  run('timing',['node','scripts/performance-v31.mjs']);run('assets',['node','scripts/assets-css-v31.mjs'])
  for version,port in [('V30',4178),('V31',4173)]:
   run('controls-'+version,['node','tests/browser-original-source-v11.mjs'],env={'ORIGINAL_SOURCE_ROOT':str(repo),'V22_SOURCE':'1','V22_BENCH':'1','TEST_FILTER':'V22 controlled','PREVIEW_URL':'http://127.0.0.1:'+str(port)})
   d=work/'performance'/version;d.mkdir(parents=True,exist_ok=True)
   for p in (extract/'docs/evidence/v22').glob('controlled*.json'):shutil.copy2(p,d/p.name)
   shutil.copy2(extract/'docs/evidence/v22/original-behavior-v22.json',d/'cases.json')
  shutil.copytree(extract/'docs/evidence/v31',work/'executed-evidence')
  run('audit-runtime',['npm','audit','--omit=dev','--json']);run('audit-all',['npm','audit','--json'])
 finally:
  for p,b in saved.items():p.write_bytes(b)
  for p in (extract/'docs/evidence').rglob('*'):
   if p.is_file() and p not in saved:p.unlink()
 print('All commands completed; failures retained. Dev audit separate. Twelve-run series NOT repeated.',flush=True)
else:raise SystemExit('Use --extract or --run')
