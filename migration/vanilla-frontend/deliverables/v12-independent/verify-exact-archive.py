"""Run ONCE after fresh unfiltered extracted tests. Preserve independent reports,
reject every code-byte difference, restore ONLY disposable generated evidence,
then require two byte-identical repacks. Never restore code to force equality.
The delivered source ZIP intentionally excludes external delivery proofs.
"""
from pathlib import Path
import hashlib,json,re,subprocess,shutil,zipfile,urllib.request,urllib.error
out=Path(__file__).resolve().parent;base=out.parents[1];scratch=base/'node_modules/v12-independent-source';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V12.zip'
meta=json.loads((out/'extraction.json').read_text());expected_sha=meta['sha256'];hashof=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert hashof(archive)==expected_sha
reports=scratch/'docs/evidence/v12';total=0
for name,n in [('browser',27),('browser-v2',14),('browser-v3',49),('browser-v4',72),('browser-v5',52),('browser-v6',77),('browser-v7',26),('browser-v8',79),('browser-v9',29),('browser-v10',53),('browser-v11',18)]:
 p=reports/(name+'-regression.json');j=json.loads(p.read_text());c=j['counts'];assert c['PASS']==n and not c.get('FAIL') and not c.get('SKIP') and not c.get('BLOCKED'),(name,c);total+=n;shutil.copyfile(p,out/p.name)
j=json.loads((reports/'browser-v12-results.json').read_text());assert j['counts']=={'PASS':3,'FAIL':0,'SKIP':0};total+=3;shutil.copyfile(reports/'browser-v12-results.json',out/'browser-v12-results.json');assert total==499
unit=(out/'unit.txt').read_text()
for s in ['# tests 351','# pass 351','# fail 0','# skipped 0','# cancelled 0']:assert re.search('^'+re.escape(s)+'$',unit,re.M),s
css=json.loads((reports/'assets-css.json').read_text());assert css['status']=='PASS' and css['assets']==25 and css['sourceCssExact'] and css['compiledCssDeterministic'];shutil.copyfile(reports/'assets-css.json',out/'assets-css.json')
original=json.loads((reports/'original-behavior-v12.json').read_text());assert original['counts']=={'PASS':27,'FAIL':0,'SKIP':0};assert original['sourceSha256']=='f33c621a737ea75215f62d2aacbfde49350d44ade6cd3dacbaebf8675c8c601e';shutil.copyfile(reports/'original-behavior-v12.json',out/'original-behavior-v12.json')
assert json.loads((out/'runtime-audit.json').read_text())['metadata']['vulnerabilities']['total']==0
try:urllib.request.urlopen('http://127.0.0.1:4174/api/frontend/session');raise AssertionError('Unexpected live API')
except urllib.error.HTTPError as e:assert e.code==503
with urllib.request.urlopen('http://127.0.0.1:4174/') as r:csp=r.headers['Content-Security-Policy'];assert csp=="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"
assert 'AUTHORED_SANDBOX = "allow-scripts"' in (scratch/'js/generated/authored-sandbox.js').read_text()
(out/'preview-security.json').write_text(json.dumps({'status':'PASS','disconnectedApiStatus':503,'csp':csp,'sandbox':'allow-scripts ONLY; source constant and executable browser assertion','liveAcceptance':'UNVERIFIED','productionChanges':'NONE'},indent=2)+'\n')
restored=[];removed=[]
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None;expected={line.split('  ',1)[1]:line.split('  ',1)[0] for line in z.read('SHA256SUMS').decode().splitlines()};assert len(expected)==768
 assert set(z.namelist())==set(expected)|{'docs/FILE_MANIFEST.md','SHA256SUMS'}
 for name,sha in expected.items():assert hashlib.sha256(z.read(name)).hexdigest()==sha
 # Exact scratch file-set comparison, excluding only packager's explicit dirs.
 actual={p.relative_to(scratch).as_posix() for p in scratch.rglob('*') if p.is_file() and not any(x in {'node_modules','build','deliverables','.git','__pycache__'} for x in p.relative_to(scratch).parts)}
 for name in sorted(actual-set(z.namelist())):
  assert name.startswith('docs/evidence/'),('Unexpected non-evidence file',name)
  p=scratch/name;dest=out/'extra-generated'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);assert hashof(p)==hashof(dest);p.unlink();removed.append(name)
 for name in z.namelist():
  p=scratch/name;data=z.read(name)
  if p.read_bytes()!=data:
   assert name.startswith('docs/evidence/'),('CODE CHANGED; do NOT restore',name)
   dest=out/'generated-before-restoration'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
   restored.append(name);p.write_bytes(data)
 for name,sha in expected.items():assert hashof(scratch/name)==sha,name
(out/'generated-evidence-restoration.json').write_text(json.dumps({'scope':'ONLY disposable independent extraction AFTER preserving independent evidence externally','restoredGeneratedEvidence':restored,'removedExtraGeneratedEvidenceAfterVerifiedExternalCopy':removed,'sourceCodeDifferences':0,'all768SourceHashesMatch':True},indent=2)+'\n')
for i in [1,2]:
 r=subprocess.run(['python3','scripts/package.py'],cwd=scratch,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(out/f'deterministic-repack-{i}.txt').write_bytes(r.stdout);assert r.returncode==0,r.stdout.decode();generated=scratch/'deliverables'/archive.name;assert hashof(generated)==expected_sha;assert generated.read_bytes()==archive.read_bytes()
subprocess.run(['python3','scripts/package.py','--verify'],cwd=scratch,check=True)
summary={'status':'PASS','continuation':'Exact verified V11; stale sandbox preserved359 files externally and reconciled ONLY by normal same-branch fast-forward','v11Baseline':'041e02c353d86320053ea54232bb58620f5818f8','sourcePackageCommit':meta['sourceCommit'],'archive':archive.name,'sha256':expected_sha,'bytes':archive.stat().st_size,'sourceFiles':768,'manifestFiles':2,'npmCi':'PASS --ignore-scripts fresh extraction','build':'PASS without original source tree','unit':{'PASS':351,'FAIL':0,'SKIP':0,'preserved':341,'newV12':10},'chromium':{'PASS':499,'FAIL':0,'SKIP':0,'preserved':496,'newV12':3,'execution':'single strict unfiltered complete runner; no REGRESSION_FROM'},'actualOriginalSource':{'PASS':27,'FAIL':0,'SKIP':0,'preserved':5,'newV12':22,'scope':'Explicit owner read-only original HTML/hooks; synthetic APIs/media; not real provider/recording/backend acceptance','comprehensiveClosures':0},'originalFrontendCodeClosures':{'complete':1,'partial':8,'scope':'Retry Weak Areas supported existing shared-audio contract; not whole authored route/frame/component promotion'},'assets':25,'sourceCssSha256':css['sourceCssSha256'],'compiledCssSha256':css['compiledCssSha256'],'byteIdenticalDeterministicRepacks':2,'runtimeVulnerabilities':0,'developmentVulnerabilities':json.loads((out/'development-audit.json').read_text())['metadata']['vulnerabilities'],'initialFailures':'Retained raw root351-unit350PASS1FAIL unchanged foundation history assertion; root original26-case25PASS1FAIL contradictory known-pair fixture. Unchanged assertions passed after isolated rerun / canonical fixture correction; fresh independent results above are separate strict runs. No threshold relaxed. See development-findings.txt.','universalMedia':'PARTIAL; parent LRU/read/deadline bounds, reactive quota retry/decoder/duplicate paths verified. Stable duration/indexed random seek/proactive decoded bounds/Blob aggregate memory/all callers/provider/Safari/hardware remain open. Blob fallback is NOT progressive.','globalRoutes':{'COMPLETE':22,'PARTIAL':15,'NOT_STARTED':71},'globalComponents':{'COMPLETE':62,'PARTIAL':17,'NOT_STARTED':127},'listeningRoutes':{'COMPLETE':9,'PARTIAL':6,'NOT_STARTED':1},'listeningComponents':{'COMPLETE':9,'PARTIAL':10,'NOT_STARTED':5},'matchedOriginalVisualAccepted':0,'liveOriginalActivitiesAccepted':0,'overallImplementationMetric':'UNDETERMINED weighted product completion','functionalSecurityMetric':'UNDETERMINED aggregate coverage denominator','visualLiveMetric':'UNDETERMINED aggregate coverage denominator','reading':'NOT STARTED','staffIntegration':'NONE; reserved35 routes and staff author untouched','productionChanges':'NONE'}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
