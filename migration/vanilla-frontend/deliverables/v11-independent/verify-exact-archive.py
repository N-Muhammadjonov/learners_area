"""Retain independent results externally, compare all code hashes, restore ONLY
scratch generated evidence, then require two byte-identical deterministic repacks.
Never overwrite original repository code, evidence or delivered ZIP.
"""
from pathlib import Path
import hashlib,json,re,subprocess,shutil,zipfile,urllib.request,urllib.error
out=Path(__file__).resolve().parent;base=out.parents[1];scratch=base/'node_modules/v11-independent-source';archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V11.zip'
meta=json.loads((out/'extraction.json').read_text());expected_sha=meta['sha256'];hashof=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert hashof(archive)==expected_sha
reports=scratch/'docs/evidence/v11';total=0
for name,n in [('browser',27),('browser-v2',14),('browser-v3',49),('browser-v4',72),('browser-v5',52),('browser-v6',77),('browser-v7',26),('browser-v8',79),('browser-v9',29),('browser-v10',53),('browser-v11',18)]:
 p=reports/(name+'-regression.json');j=json.loads(p.read_text());c=j['counts'];assert c['PASS']==n and not c.get('FAIL') and not c.get('SKIP') and not c.get('BLOCKED'),(name,c);total+=n;shutil.copyfile(p,out/p.name)
assert total==496
unit=(out/'unit.txt').read_text()
for s in ['# tests 341','# pass 341','# fail 0','# skipped 0']:assert re.search('^'+re.escape(s)+'$',unit,re.M),s
css=json.loads((reports/'assets-css.json').read_text());assert css['status']=='PASS' and css['assets']==25 and css['sourceCssExact'] and css['compiledCssDeterministic'];shutil.copyfile(reports/'assets-css.json',out/'assets-css.json')
original=json.loads((reports/'original-behavior-v11.json').read_text());assert original['counts']=={'PASS':5,'FAIL':0,'SKIP':0};shutil.copyfile(reports/'original-behavior-v11.json',out/'original-behavior-v11.json')
assert json.loads((out/'runtime-audit.json').read_text())['metadata']['vulnerabilities']['total']==0
try:urllib.request.urlopen('http://127.0.0.1:4174/api/frontend/session');raise AssertionError('Unexpected live API')
except urllib.error.HTTPError as e:assert e.code==503
with urllib.request.urlopen('http://127.0.0.1:4174/') as r:csp=r.headers['Content-Security-Policy'];assert "script-src 'self'" in csp and "media-src 'self'" in csp and 'unsafe-eval' not in csp
(out/'preview-security.json').write_text(json.dumps({'status':'PASS','disconnectedApiStatus':503,'csp':csp,'sandbox':'allow-scripts ONLY; executable browser assertion','productionChanges':'NONE'},indent=2)+'\n')
restored=[]
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None;expected={line.split('  ',1)[1]:line.split('  ',1)[0] for line in z.read('SHA256SUMS').decode().splitlines()};assert len(expected)==727
 assert set(z.namelist())==set(expected)|{'docs/FILE_MANIFEST.md','SHA256SUMS'}
 for name,sha in expected.items():assert hashlib.sha256(z.read(name)).hexdigest()==sha
 for name in z.namelist():
  p=scratch/name;data=z.read(name)
  if p.read_bytes()!=data:
   assert name.startswith('docs/evidence/'),name
   restored.append(name);p.write_bytes(data)
 for name,sha in expected.items():assert hashof(scratch/name)==sha,name
(out/'generated-evidence-restoration.json').write_text(json.dumps({'scope':'ONLY disposable independent extraction, AFTER retaining independent reports externally','restoredGeneratedEvidence':restored,'sourceCodeDifferences':0,'all727SourceHashesMatch':True},indent=2)+'\n')
for i in [1,2]:
 r=subprocess.run(['python3','scripts/package.py'],cwd=scratch,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(out/f'deterministic-repack-{i}.txt').write_bytes(r.stdout);assert r.returncode==0,r.stdout.decode();generated=scratch/'deliverables'/archive.name;assert hashof(generated)==expected_sha;assert generated.read_bytes()==archive.read_bytes()
subprocess.run(['python3','scripts/package.py','--verify'],cwd=scratch,check=True)
summary={'status':'PASS','recovery':'NOT recovered; Owner-authorized safe reimplementation from V10 after verified359-file external backup and normal fast-forward','sourcePackageCommit':'cd5cc95b2d7ca9316c8f5d5f597550aacac66ffd','v10Baseline':'9c62895674025159b4dcbab839bb1fb8f37348af','archive':archive.name,'sha256':expected_sha,'bytes':archive.stat().st_size,'sourceFiles':727,'manifestFiles':2,'npmCi':'PASS --ignore-scripts, fresh extraction','build':'PASS without original source tree','unit':{'PASS':341,'FAIL':0,'SKIP':0},'chromium':{'PASS':496,'FAIL':0,'SKIP':0,'preserved':478,'v11':18},'actualOriginalSource':{'PASS':5,'FAIL':0,'SKIP':0,'scope':'Extra opt-in read-only original HTML/hooks under isolated APIs/synthetic media; not live backend or recording acceptance','comprehensiveClosures':0},'assets':25,'sourceCssSha256':css['sourceCssSha256'],'compiledCssSha256':css['compiledCssSha256'],'deterministicByteIdenticalRepacks':2,'runtimeVulnerabilities':0,'developmentVulnerabilities':json.loads((out/'dev-audit.json').read_text())['metadata']['vulnerabilities'],'initialRootFailure':'unchanged Phase2 DOM-bound assertion failed on first root run; retained; unchanged full77-case suite subsequently passed. Not hidden or threshold-relaxed. Fresh independent result above is a separate strict run.','visual':'12 synthetic candidate captures,3 root inspections;0 accepted matched original-rendered comparisons','liveIntegration':'UNVERIFIED','listening':'PARTIAL;9/6/1 routes of16,9/10/5 components of24;original9 comprehensive0/9','reading':'NOT STARTED','productionChanges':'NONE'}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
