"""Post-test verifier: preserve generated evidence externally, reject changed code,
restore ONLY generated evidence in disposable extraction, require two exact repacks."""
from pathlib import Path
import json,hashlib,re,shutil,subprocess,zipfile,urllib.request,urllib.error
out=Path(__file__).resolve().parent;base=out.parents[1];scratch=base/'node_modules/v14-independent-source';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V14.zip'
meta=json.loads((out/'extraction.json').read_text());hashof=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert hashof(archive)==meta['sha256'];reports=scratch/'docs/evidence/v14';total=0
for name,count in [('browser',27),('browser-v2',14),('browser-v3',49),('browser-v4',72),('browser-v5',52),('browser-v6',77),('browser-v7',26),('browser-v8',79),('browser-v9',29),('browser-v10',53),('browser-v11',18),('browser-v12',3)]:
 p=reports/(name+'-regression.json');j=json.loads(p.read_text());c=j['counts'];assert c['PASS']==count and not c.get('FAIL') and not c.get('SKIP') and not c.get('BLOCKED'),(name,c);total+=count
assert total==499
unit=(out/'unit.txt').read_text()
for text in ['# tests 378','# pass 378','# fail 0','# skipped 0','# cancelled 0']:assert re.search('^'+re.escape(text)+'$',unit,re.M),text
original=json.loads((reports/'original-behavior-v14.json').read_text());assert original['counts']=={'PASS':64,'FAIL':0,'SKIP':0};assert original['sourceSha256']=='f33c621a737ea75215f62d2aacbfde49350d44ade6cd3dacbaebf8675c8c601e'
css=json.loads((reports/'assets-css.json').read_text());assert css['status']=='PASS' and css['assets']==25 and css['sourceCssExact'] and css['compiledCssDeterministic']
for p in reports.rglob('*'):
 if p.is_file():dest=out/'generated-evidence'/p.relative_to(reports);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);assert hashof(p)==hashof(dest)
try:urllib.request.urlopen('http://127.0.0.1:4187/api/frontend/session');raise AssertionError('Unexpected live API')
except urllib.error.HTTPError as e:assert e.code==503
with urllib.request.urlopen('http://127.0.0.1:4187/') as r:csp=r.headers['Content-Security-Policy'];assert csp=="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"
assert 'AUTHORED_SANDBOX = "allow-scripts"' in (scratch/'js/generated/authored-sandbox.js').read_text()
(out/'preview-security.json').write_text(json.dumps({'status':'PASS','disconnectedApiStatus':503,'csp':csp,'sandbox':'allow-scripts ONLY','credentialsOrPrivateUrlsToChild':'NONE','liveAcceptance':'UNVERIFIED'},indent=2)+'\n')
restored=[];removed=[]
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None;expected={line.split('  ',1)[1]:line.split('  ',1)[0] for line in z.read('SHA256SUMS').decode().splitlines()};assert set(z.namelist())==set(expected)|{'docs/FILE_MANIFEST.md','SHA256SUMS'}
 actual={p.relative_to(scratch).as_posix() for p in scratch.rglob('*') if p.is_file() and not any(x in {'node_modules','build','deliverables','.git','__pycache__'} for x in p.relative_to(scratch).parts)}
 for name in sorted(actual-set(z.namelist())):
  assert name.startswith('docs/evidence/'),('Unexpected non-evidence file',name)
  p=scratch/name;dest=out/'extra-generated'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);assert hashof(p)==hashof(dest);p.unlink();removed.append(name)
 for name in z.namelist():
  data=z.read(name);p=scratch/name
  if name in expected:assert hashlib.sha256(data).hexdigest()==expected[name]
  if p.read_bytes()!=data:
   assert name.startswith('docs/evidence/'),('CODE DIFFERENCE; never restore code',name)
   dest=out/'generated-before-restoration'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);p.write_bytes(data);restored.append(name)
 for name,sha in expected.items():assert hashof(scratch/name)==sha,name
(out/'generated-evidence-restoration.json').write_text(json.dumps({'scope':'Disposable extraction after independent results preserved externally','restoredEvidenceOnly':restored,'removedExtraEvidenceAfterVerifiedCopy':removed,'sourceCodeDifferences':0,'sourceFilesVerified':len(expected)},indent=2)+'\n')
for i in [1,2]:
 r=subprocess.run(['python3','scripts/package.py'],cwd=scratch,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(out/f'deterministic-repack-{i}.txt').write_bytes(r.stdout);assert r.returncode==0,r.stdout.decode();assert (scratch/'deliverables'/archive.name).read_bytes()==archive.read_bytes()
assert json.loads((out/'runtime-audit.json').read_text())['metadata']['vulnerabilities']['total']==0
summary={'status':'PASS','baseline':'d6ed38b9d01d62d8addd8b656a41451e9842d5f4','sourcePackageCommit':meta['sourceCommit'],'archive':archive.name,'sha256':meta['sha256'],'bytes':archive.stat().st_size,'sourceFiles':len(expected),'manifestFiles':2,'freshNpmCi':'PASS --ignore-scripts','independentBuild':'PASS without original source tree','unit':{'PASS':378,'FAIL':0,'SKIP':0,'preservedV13':363,'newV14':15},'chromium':{'PASS':499,'FAIL':0,'SKIP':0,'preservedV13':499,'execution':'single strict unfiltered full runner'},'actualOriginalSource':{'PASS':64,'FAIL':0,'SKIP':0,'preservedV13':43,'newV14':21,'scope':'actual authorized read-only source and adaptation; isolated API/encoded-media fixtures, NOT recording/live alignment'},'assets':25,'sourceCssSha256':css['sourceCssSha256'],'compiledCssSha256':css['compiledCssSha256'],'byteIdenticalRepacks':2,'runtimeVulnerabilities':0,'developmentVulnerabilities':json.loads((out/'development-audit.json').read_text())['metadata']['vulnerabilities'],'activityFrontend':{'COMPLETE':1,'PARTIAL':8,'scope':'V12 Retry preserved, Full remains PARTIAL, Review V14 NOT started'},'comprehensiveOriginalClosures':0,'liveOriginalClosures':0,'routes':{'COMPLETE':22,'PARTIAL':15,'NOT_STARTED':71},'components':{'COMPLETE':62,'PARTIAL':17,'NOT_STARTED':127},'listeningRoutes':{'COMPLETE':9,'PARTIAL':6,'NOT_STARTED':1},'listeningComponents':{'COMPLETE':9,'PARTIAL':10,'NOT_STARTED':5},'implementationMetric':'UNDETERMINED weighted product denominator; source counts above','functionalSecurityMetric':'UNDETERMINED product coverage; bounded fixture ratios above','visualLiveMetric':'UNDETERMINED product denominator; matched-original rendered0/live0','universalMedia':'PARTIAL; V13 engine preserved, Blob fallback NOT progressive','reading':'NOT STARTED','staffRoutesReserved':35,'backendDatabaseCloudMainStaffProductionChanges':'NONE','initialFailures':'Initial18 new-source7PASS11FAIL retained:9 retries used unallowlisted new op; fixed integration to existing token-bound storage retryOnly, no allowlist/CSP weakening. Two access tests tried entering intentionally removed403/404 frame; assert no-frame/no-score. Existing baseline assertions unchanged;18/20/21 targeted passes are separate snapshots. Fresh independent outcome separate.'}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
