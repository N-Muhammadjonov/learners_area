#!/usr/bin/env python3
"""Verify actual final archive only after extracted fresh build/unit/browser succeeded."""
import hashlib,json,pathlib,re,shutil,subprocess,zipfile
REPO=pathlib.Path('/home/user/learners_area/migration/vanilla-frontend')
EXTRACT=pathlib.Path('/tmp/learners-v9-final-exact')
OUT=REPO/'deliverables/v9-independent'
ARCHIVE=REPO/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V9.zip'
sha=lambda b:hashlib.sha256(b).hexdigest()
expected=sha(ARCHIVE.read_bytes())
assert ARCHIVE.with_suffix('.zip.sha256').read_text()==expected+'  '+ARCHIVE.name+'\n'
with zipfile.ZipFile(ARCHIVE) as z:original={n:z.read(n) for n in z.namelist()};assert z.testzip() is None
manifest=dict((name,h) for h,name in (line.split('  ',1) for line in original['SHA256SUMS'].decode().splitlines()))
assert len(original)==len(manifest)+2
for name,h in manifest.items():assert sha(original[name])==h,name
reports=[]
for name,count in [('browser',27),('browser-v2',14),('browser-v3',49),('browser-v4',72),('browser-v5',52),('browser-v6',77),('browser-v7',26),('browser-v8',79)]:
 source=EXTRACT/f'docs/evidence/v9/{name}-regression.json';data=json.loads(source.read_text())
 assert data['counts']['PASS']==count and not any(data['counts'].get(k,0) for k in ['FAIL','SKIP','BLOCKED']),name
 shutil.copyfile(source,OUT/source.name);reports.append({'suite':name,**data['counts']})
for name in ['browser-v9-results.json','assets-css.json']:
 source=EXTRACT/f'docs/evidence/v9/{name}';shutil.copyfile(source,OUT/name)
browser=json.loads((OUT/'browser-v9-results.json').read_text());assert browser['counts']=={'PASS':29,'FAIL':0,'SKIP':0}
assert re.search(r'# pass 303\n# fail 0\n# cancelled 0\n# skipped 0',(OUT/'unit.txt').read_text())
assert json.loads((OUT/'npm-ci-status.json').read_text())=={'exitCode':0}
assets=json.loads((OUT/'assets-css.json').read_text());assert assets['status']=='PASS' and assets['assets']==25 and assets['compiledCssDeterministic'] and not assets['renderedVisualComparison']
excluded={'node_modules','build','.git','deliverables','__pycache__'}
actual={p.relative_to(EXTRACT).as_posix() for p in EXTRACT.rglob('*') if p.is_file() and not any(x in excluded for x in p.relative_to(EXTRACT).parts)}
assert actual==set(original),(actual-set(original),set(original)-actual)
changed=[name for name,content in original.items() if (EXTRACT/name).read_bytes()!=content]
assert all(n.startswith('docs/evidence/') for n in changed),changed
# External capture BEFORE restoring only variable browser/evidence bytes. Every tested runtime,
# build input, source, stylesheet and asset must ALREADY match the archive, without rewriting it.
for name,content in original.items():(EXTRACT/name).write_bytes(content)
for name,h in manifest.items():assert sha((EXTRACT/name).read_bytes())==h,name
repacked=[]
for i in [1,2]:
 result=subprocess.run(['python3','scripts/package.py'],cwd=EXTRACT,check=True,text=True,capture_output=True)
 (OUT/f'deterministic-repack-{i}.txt').write_text(result.stdout+result.stderr)
 artifact=EXTRACT/'deliverables'/ARCHIVE.name;assert sha(artifact.read_bytes())==expected
 repacked.append(sha(artifact.read_bytes()))
summary={'status':'PASS','archiveSha256':expected,'archiveBytes':ARCHIVE.stat().st_size,'sourceFiles':len(manifest),'manifestFiles':2,'freshNpmCi':True,'freshBuild':True,'unit':{'PASS':303,'FAIL':0,'SKIP':0},'browser':{'historical':396,'v9':29,'PASS':425,'FAIL':0,'SKIP':0},'preservedSuites':reports,'assets':25,'compiledCssSha256':assets['compiledCssSha256'],'sourceCssSha256':assets['sourceCssSha256'],'runtimeAssetsIdenticalAfterIndependentBuild':True,'changedEvidenceRestoredAfterExternalCapture':changed,'independentRepackSha256':repacked,'originalRenderedVisualAccepted':0,'liveAccepted':0,'providerAccepted':0,'safariHardwareAccepted':0,'productionChanges':'NONE'}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
