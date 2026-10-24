#!/usr/bin/env python3
"""V32 exact artifact verification only; zero added Phase2/native diagnostics.
--extract verifies source/seal bytes and fresh installs/builds extracted V32 plus sealed V31 reference.
Start previews4173/4178, then --run ONCE. Stop expansion on a new mandatory command failure.
"""
import pathlib,zipfile,hashlib,json,subprocess,os,sys,shutil
repo=pathlib.Path('/home/user/learners_area');base=repo/'migration/vanilla-frontend';work=pathlib.Path('/home/user/v32-independent');extract=work/'extracted';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V32.zip';work.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def run(name,args,cwd=extract,env=None):
 with (work/(name+'.txt')).open('w') as log:r=subprocess.run(args,cwd=cwd,env=os.environ|(env or {}),stdout=log,stderr=subprocess.STDOUT)
 p=work/'commands.json';state=json.loads(p.read_text()) if p.exists() else [];state.append({'name':name,'args':args,'cwd':str(cwd),'exit':r.returncode});p.write_text(json.dumps(state,indent=2));print(state[-1],flush=True);return r.returncode
def need(name,args,cwd=extract,env=None):
 status=run(name,args,cwd,env)
 if status:raise RuntimeError('New mandatory failure: '+name+'; evidence retained. Stop expansion; written causal plan required before any rerun.')
if '--extract' in sys.argv:
 assert not extract.exists();extract.mkdir();members=[];ids=json.loads((work/'identities.json').read_text())
 with zipfile.ZipFile(archive) as z:
  assert len(z.namelist())==len(set(z.namelist())) and z.testzip() is None
  expected=dict(line.split('  ',1)[::-1] for line in z.read('SHA256SUMS').decode().splitlines());assert set(z.namelist())==set(expected)|{'SHA256SUMS','docs/FILE_MANIFEST.md'}
  for info in z.infolist():
   name=info.filename;assert not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts and '\\' not in name and info.external_attr>>16==0o100644
   data=z.read(name);digest=sha(data);assert name not in expected or digest==expected[name]
   commit=ids['sealCommit'] if name in ['SHA256SUMS','docs/FILE_MANIFEST.md'] else ids['sourceCommit'];assert subprocess.check_output(['git','-C',str(repo),'show',commit+':migration/vanilla-frontend/'+name])==data,name;members.append({'path':name,'sha256':digest})
  z.extractall(extract)
 (work/'extraction.json').write_text(json.dumps({'archiveSHA256':sha(archive.read_bytes()),'archiveBytes':archive.stat().st_size,'members':members,'CRC':'PASS','safeUniqueMembers':'PASS','everyMemberGitIdentity':'PASS'},indent=2))
 need('npm-ci',['npm','ci']);need('build',['npm','run','build']);reference=work/'reference-v31';assert not reference.exists();reference.mkdir()
 with zipfile.ZipFile(base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V31.zip') as z:assert z.testzip() is None;z.extractall(reference)
 need('reference-npm-ci',['npm','ci'],cwd=reference);need('reference-build',['npm','run','build'],cwd=reference)
elif '--run' in sys.argv:
 assert not (work/'run-started.json').exists(),'No unchanged rerun: preserve this execution and make a causal plan.'
 (work/'run-started.json').write_text(json.dumps({'scope':'Required exact-ZIP suites only; original Phase2 once within499; no new stability series or native study'}))
 saved={p:p.read_bytes() for p in (extract/'docs/evidence').rglob('*') if p.is_file()};original={'ORIGINAL_SOURCE_ROOT':str(repo),'V27_SOURCE':'1'}|{f'V{i}_SOURCE':'1' for i in range(12,27)}
 try:
  need('unit',['npm','test']);need('chromium',['node','scripts/regression-v32.mjs'])
  sourcePath=extract/'docs/evidence/v27/original-behavior-v27.json';sourcePath.unlink(missing_ok=True)
  status=run('source',['node','tests/browser-original-source-v11.mjs'],env=original)
  if sourcePath.exists():shutil.copy2(sourcePath,work/'original-source-full.json')
  if status:raise RuntimeError('New mandatory source failure: preserve full/partial report and stop expansion; no unchanged retry.')
  need('timing',['node','scripts/performance-v32.mjs']);need('assets',['node','scripts/assets-css-v32.mjs'])
  for version,port in [('V31',4178),('V32',4173)]:
   status=run('controls-'+version,['node','tests/browser-original-source-v11.mjs'],env={'ORIGINAL_SOURCE_ROOT':str(repo),'V22_SOURCE':'1','V22_BENCH':'1','TEST_FILTER':'V22 controlled','PREVIEW_URL':'http://127.0.0.1:'+str(port)})
   d=work/'performance'/version;d.mkdir(parents=True,exist_ok=True)
   for p in (extract/'docs/evidence/v22').glob('controlled*.json'):shutil.copy2(p,d/p.name)
   shutil.copy2(extract/'docs/evidence/v22/original-behavior-v22.json',d/'cases.json')
   if status:raise RuntimeError('New mandatory control failure '+version+'; stop expansion.')
  need('audit-runtime',['npm','audit','--omit=dev','--json']);run('audit-all',['npm','audit','--json'])
 finally:
  shutil.copytree(extract/'docs/evidence/v32',work/'executed-evidence')
  for p in (extract/'docs/evidence').rglob('*'):
   if p.is_file() and ('v32' not in p.relative_to(extract/'docs/evidence').parts) and (p not in saved or p.read_bytes()!=saved[p]):
    q=work/'changed-observations'/p.relative_to(extract/'docs/evidence');q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes())
  for p,data in saved.items():p.write_bytes(data)
  for p in (extract/'docs/evidence').rglob('*'):
   if p.is_file() and p not in saved:p.unlink()
 print('Exact verification completed; dev audit separate. No added Phase2/native diagnostic runs.',flush=True)
else:raise SystemExit('Use --extract or --run')
