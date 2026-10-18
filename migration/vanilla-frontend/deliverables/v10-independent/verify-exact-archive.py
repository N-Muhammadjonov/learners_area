"""Validate the independently tested V10 source, then restore ONLY this scratch
extraction's generated evidence to sealed bytes and prove two deterministic repacks.
Original repository source and the delivered ZIP are never rewritten here.
"""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,sys,zipfile,urllib.request,urllib.error
out=Path(__file__).resolve().parent;base=out.parents[1];scratch=base/'node_modules/v10-independent-source'
archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V10.zip'
expected_sha='64fa1cdac41632502a8a2df903189b3d2d48d44e331fd4fc1c0c9fb37deeb469'
hashof=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert hashof(archive)==expected_sha
reports=scratch/'docs/evidence/v10';historical=0
for name in ['browser','browser-v2','browser-v3','browser-v4','browser-v5','browser-v6','browser-v7','browser-v8','browser-v9']:
 p=reports/(name+'-regression.json');j=json.loads(p.read_text());c=j['counts'];assert c.get('FAIL',0)==0 and c.get('SKIP',0)==0 and c.get('BLOCKED',0)==0,(name,c);historical+=c['PASS'];shutil.copyfile(p,out/p.name)
assert historical==425,historical
j=json.loads((reports/'browser-v10-results.json').read_text());assert j['counts']=={'PASS':53,'FAIL':0,'SKIP':0},j['counts'];shutil.copyfile(reports/'browser-v10-results.json',out/'browser-v10-results.json')
unit=(out/'unit.txt').read_text();assert re.search(r'^# tests 323$',unit,re.M) and re.search(r'^# pass 323$',unit,re.M) and re.search(r'^# fail 0$',unit,re.M) and re.search(r'^# skipped 0$',unit,re.M)
css=json.loads((reports/'assets-css.json').read_text());assert css['status']=='PASS' and css['assets']==25 and css['sourceCssExact'] and css['compiledCssDeterministic'];shutil.copyfile(reports/'assets-css.json',out/'assets-css.json')
audit=json.loads((out/'runtime-audit.json').read_text());assert audit['metadata']['vulnerabilities']['total']==0
try:urllib.request.urlopen('http://127.0.0.1:4174/api/frontend/session');raise AssertionError('Unexpected API success')
except urllib.error.HTTPError as e:assert e.code==503
with urllib.request.urlopen('http://127.0.0.1:4174/') as response:
 csp=response.headers['Content-Security-Policy'];assert "script-src 'self'" in csp and "media-src 'self'" in csp
(out/'preview-security.json').write_text(json.dumps({'status':'PASS','disconnectedApiStatus':503,'contentSecurityPolicy':csp,'backend':'not connected; no fabricated session','sandbox':'allow-scripts only, executable browser assertions'},indent=2)+'\n')
restored=[]
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 expected={line.split('  ',1)[1]:line.split('  ',1)[0] for line in z.read('SHA256SUMS').decode().splitlines()};assert len(expected)==665
 assert set(z.namelist())==set(expected)|{'docs/FILE_MANIFEST.md','SHA256SUMS'}
 for name,sha in expected.items():assert hashlib.sha256(z.read(name)).hexdigest()==sha,name
 for name in z.namelist():
  p=scratch/name;data=z.read(name)
  if p.read_bytes()!=data:
   # Only independently generated evidence is allowed to differ. CSS/code/asset
   # identity is a real gate, never "fixed" by restoration.
   assert name.startswith('docs/evidence/'),name
   restored.append(name);p.write_bytes(data)
 for name,sha in expected.items():assert hashof(scratch/name)==sha,name
(out/'generated-evidence-restoration.json').write_text(json.dumps({'scope':'temporary independent extraction ONLY; after retaining independent reports externally','restoredGeneratedEvidence':restored,'sourceCodeDifferences':0,'all665SourceHashesMatchedAfterRestoration':True},indent=2)+'\n')
for i in [1,2]:
 r=subprocess.run([sys.executable,'scripts/package.py'],cwd=scratch,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(out/f'deterministic-repack-{i}.txt').write_bytes(r.stdout);assert r.returncode==0,r.stdout.decode()
 generated=scratch/'deliverables'/archive.name;assert hashof(generated)==expected_sha,(i,hashof(generated));assert generated.read_bytes()==archive.read_bytes()
subprocess.run([sys.executable,'scripts/package.py','--verify'],cwd=scratch,check=True)
summary={'status':'PASS','sourcePackageCommit':'7ffbd2cbb8a56253067a4423678be36801a28f00','v9Baseline':'b9d9c8517c1301ea3e75ed632b23c5b40c2d452b','archive':archive.name,'sha256':expected_sha,'bytes':archive.stat().st_size,'sourceFiles':665,'manifestFiles':2,'independentNpmCi':'PASS --ignore-scripts; new extraction, no original source tree','independentBuild':'PASS','independentUnit':{'PASS':323,'FAIL':0,'SKIP':0},'independentChromium':{'PASS':478,'FAIL':0,'SKIP':0,'historical':425,'v10':53},'audioAfterPaint':'PASS shared range bridge + generic native controls; decodable synthetic WAV; repeated generic inner-page navigation one authorized blob read; route cleanup','assets':25,'sourceCssSha256':css['sourceCssSha256'],'compiledCssSha256':css['compiledCssSha256'],'deterministicRepacks':2,'byteIdenticalToDeliveredArchive':True,'runtimeVulnerabilities':0,'developmentVulnerabilities':json.loads((out/'dev-audit.json').read_text())['metadata']['vulnerabilities'],'originalNineComprehensiveAcceptance':0,'originalNineNavigation':'9 genuine identities from read-only original checkout; separate development probe, not bundled curriculum or independent full-workflow acceptance','visualOriginalRendered':'UNVERIFIED;0 accepted comparisons','liveIntegration':'UNVERIFIED','productionChanges':'NONE'}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
