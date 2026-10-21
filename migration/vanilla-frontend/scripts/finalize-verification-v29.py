#!/usr/bin/env python3
"""Build V29 external report strictly from retained executions and sealed bytes."""
import pathlib,json,hashlib,subprocess,re,math,statistics,zipfile,collections
repo=pathlib.Path('/home/user/learners_area');base=repo/'migration/vanilla-frontend';w=pathlib.Path('/home/user/v29-independent');e=w/'executed-evidence';old=json.loads((base/'deliverables/V28_VERIFICATION.json').read_text());ids=json.loads((w/'identities.json').read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
def load(p):return json.loads(p.read_text())
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a])
archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V29.zip';extraction=load(w/'extraction.json');assert sha(archive.read_bytes())==extraction['archiveSHA256']
unit=(w/'unit.txt').read_text();units={k:int(re.search(r'^# '+k+r' (\d+)$',unit,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped']};assert units['tests']==540
prior=next(r['text'] for r in old['rawExecutionLogs'] if r['name'] in ['unit.txt','units.txt']);prior_names=set(re.findall(r'^# Subtest: (.*)$',prior,re.M));assert prior_names<=set(re.findall(r'^# Subtest: (.*)$',unit,re.M))
assert collections.Counter(re.findall(r'^# Subtest: (.*)$',prior,re.M)) <= collections.Counter(re.findall(r'^# Subtest: (.*)$',unit,re.M))
browser=[]
for p in old['executedReports']:
 current=load(e/'baseline-chromium'/(p['name']+'-regression.json'));assert [r['name'] for r in p['data']['results']]==[r['name'] for r in current['results']];browser.append({'name':p['name'],'data':current})
chromium={k:sum(p['data']['counts'].get(k,0) for p in browser) for k in ['PASS','FAIL','SKIP']};assert sum(chromium.values())==499
source=load(w/'original-source-full.json');assert [r['name'] for r in source['results']]==[r['name'] for r in old['originalSourceReport']['results']];assert sum(source['counts'].values())==418
for row in extraction['members']:
 commit=ids['sealCommit'] if row['path'] in ['SHA256SUMS','docs/FILE_MANIFEST.md'] else ids['sourceCommit'];b=git('show',commit+':migration/vanilla-frontend/'+row['path']);assert sha(b)==row['sha256'],row['path']
preserved=[]
for row in old['outsideMigrationManifest']:
 assert sha((repo/row['path']).read_bytes())==row['sha256'];preserved.append(row)
archives=old['historicalArchives']+[{'path':'migration/vanilla-frontend/deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V28.zip','bytes':old['archive']['bytes'],'sha256':old['archive']['sha256']}]
for row in archives:assert sha((repo/row['path']).read_bytes())==row['sha256']
historical=[]
for row in git('ls-tree','-r','4576299d0bf9c05e1af5f963d8d2d302e2731cab','migration/vanilla-frontend/docs/evidence/').decode().splitlines():
 header,name=row.split('\t',1);oid=header.split()[2];b=(repo/name).read_bytes();assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==oid;historical.append({'path':name,'sha256':sha(b)})
changed=git('diff','--name-only','4576299d0bf9c05e1af5f963d8d2d302e2731cab',ids['sourceCommit'],'--','migration/vanilla-frontend/js','migration/vanilla-frontend/modules','migration/vanilla-frontend/css','migration/vanilla-frontend/fonts','migration/vanilla-frontend/brand','migration/vanilla-frontend/images').decode();assert not changed
repacks=[]
for i in range(2):
 r=subprocess.run(['python3','scripts/package.py'],cwd=w/'extracted',capture_output=True,text=True);assert r.returncode==0,r.stderr
 p=w/'extracted/deliverables'/archive.name;assert p.read_bytes()==archive.read_bytes();repacks.append({'run':i+1,'sha256':sha(p.read_bytes()),'byteIdentical':True})
def stats(xs):
 s=sorted(xs);return {'n':len(xs),'median':statistics.median(xs),'p95NearestRank':s[math.ceil(.95*len(s))-1],'raw':xs}
perf={}
for version in ['V28','V29']:
 for delay in [0,40]:
  report=load(w/'performance'/version/('controlled-'+str(delay)+'.json'));rows=report['samples'];assert len(rows)==20;perf[version+'-'+str(delay)]={'rawReport':report,**{key:stats([r[key] for r in rows]) for key in rows[0] if all(isinstance(r.get(key),(int,float)) and not isinstance(r[key],bool) for r in rows)}}
logs=[{'name':p.name,'sha256':sha(p.read_bytes()),'text':p.read_text()} for p in sorted(w.glob('*.txt'))]
phase=old['phase2']['fixedFourRun'];resources=load(e/'resources-handle-control.json');timing=load(e/'timing/browser-performance.json') if (e/'timing/browser-performance.json').exists() else None
if timing is None:
 candidates=list((e/'timing').glob('*results*.json'));assert len(candidates)==1,candidates;timing=load(candidates[0])
report={'checkpoint':'V29','branch':'arena/96836bcf-learners-area',**ids,'reportCommit':'SELF: resolve git log -1 -- migration/vanilla-frontend/deliverables/V29_VERIFICATION.json','baseline':{'finalHead':'4576299d0bf9c05e1af5f963d8d2d302e2731cab','sourceCommit':old['sourceCommit'],'sealCommit':old['sealCommit'],'archive':old['archive']},'archive':{'name':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes())},'independentExtraction':extraction,'allZIPMembersGitByteIdentity':True,'twoIdenticalRepacks':repacks,'commands':load(w/'commands.json'),'units':units,'baselineUnitNamesPreserved':len(prior_names),'chromium':chromium,'executedReports':browser,'originalSource':source['counts'],'originalSourceReport':source,'timingReport':timing,'controlledBenchmarkCases':{v:load(w/'performance'/v/'cases.json') for v in ['V28','V29']},'performance':perf,'historicalV28Performance':old['performance'],'performanceLimitations':old['performanceLimitations'],'phase2':{'status':'OPEN','fixedFourRun':phase,'historicalEvidence':old['phase2'],'matchedOwnershipLimit':'Historical13 raw identities absent; all fresh targets enumerated, native/inspector ownership not exclusively resolved.'},'resources':resources,'presealResources':load(base/'docs/evidence/v29/resources-plain.json'),'resourceAttribution':load(base/'docs/evidence/v29/native-delta.json'),'frameHandleOwnership':load(e/'handle-ownership.json'),'ownershipChronology':(base/'docs/V29_RESOURCE_PLAN.md').read_text(),'applicationByteIdentityToV28':True,'implementation':'Actual403 harness repair: wait for native initial Exam activity before original results observation. Measured16-node slope attributed to pointer hit-test inspector handles; scoped diagnostic cleanup, no website runtime workaround.','status':old['status'],'inventory':old['inventory'],'mixedLifecycleMatrixPreserved':old['mixedLifecycleMatrixPreserved'],'sourceVariantsPreserved':old['sourceVariantsPreserved'],'sourceVariantsRerun':False,'timingHandoff':old['timingHandoff'],'visualConditionEvidencePreserved':old['visualConditionEvidencePreserved'],'outsideMigrationManifest':preserved,'historicalArchives':archives,'historicalEvidencePreserved':historical,'rawExecutionLogs':logs,'assetsCss':load(e/'assets-css.json'),'directOriginalAssets':load(base/'docs/evidence/v29/assets-css.json'),'externalLimitations':old['externalLimitations'],'nextTask':'V29 continuation only: precise native/opaque/inspection-sensitive ownership and16-node-per-cycle source probe growth; historical13 IDs only if original heap available. Preserve all15/30 proofs and strict failures. No V29 started.'}
(base/'deliverables/V29_VERIFICATION.json').write_text(json.dumps(report,indent=2)+'\n')

report['recovery403']={'rootCause':(base/'docs/V29_403_ROOT_CAUSE.md').read_text(),'historicalV28Failure':old['failedOriginalSourceCases'],'historicalV28Counts':old['originalSource'],'focused':load(base/'docs/evidence/v29/403-repaired-case.json'),'beforeResourceFullSource':load(base/'docs/evidence/v29/repaired-full-source.json'),'controlledOrder':load(e/'403-order-counterexample.json')}
report['resourcesScope']=(base/'docs/V29_RESOURCE_OWNERSHIP.md').read_text();report['phase2']['currentOriginalCase']=next(r for b in browser for r in b['data']['results'] if r['name']=='Phase2 repeated real content navigation retains shell and bounded DOM/listeners')
report['archive']['sourceMembers']=len(extraction['members'])-2;report['archive']['generatedMembers']=2
report['referenceV28Proof']=load(pathlib.Path('/home/user/v29-reference/proof.json'))
report['audits']={key:load(w/file)['metadata']['vulnerabilities'] for key,file in [('runtime','audit-runtime.txt'),('all','audit-all.txt')]}
report['casePreservationProof']={'unitNames':540,'chromiumNames':499,'sourceNames':418,'timingNames':14,'controls':4,'noAssertionWeakening':True}
assert [r['name'] for r in timing['results']]==[r['name'] for r in old['timingReport']['results']]
for v in ['V28','V29']:assert load(w/'performance'/v/'cases.json')['counts']=={'PASS':2,'FAIL':0,'SKIP':0}
positive=units['pass']==540 and units['fail']==0 and chromium=={'PASS':499,'FAIL':0,'SKIP':0} and source['counts']=={'PASS':418,'FAIL':0,'SKIP':0} and timing['counts']=={'PASS':14,'FAIL':0}
report['acceptanceCategories']={'frontendImplementation':'403 harness defect repaired; accepted website runtime unchanged','mandatoryFixtureRegression':'PASS' if positive else 'PARTIAL/FAILED','phase2':'OPEN','resourceLifecycle':'Measured16-node slope ATTRIBUTED to orphan inspector handles; broader native lifecycle PARTIAL','comprehensiveOriginal':'UNVERIFIED0/9','matchedOriginalVisual':'UNVERIFIED','authorizedLive':'UNVERIFIED0/9','hardwareSafariOriginalRecordings':'UNVERIFIED'}
report['status']['fixtureVerification']='PASS' if positive else 'PARTIAL/FAILED'
report['nextTask']='V30 continuation ONLY: remaining Review native/opaque/media/hardware acceptance and original Phase2 stability; preserve repaired403 native-navigation gate and measured inspector-handle attribution. No repeat16-node investigation without concrete regression; historical13 identities only if original heap available. No V30 begun.'
(base/'deliverables/V29_VERIFICATION.json').write_text(json.dumps(report,indent=2)+'\n')
text=f"""V29 —403 harness repair and resource ownership checkpoint; Review PARTIAL
A. Branch arena/96836bcf-learners-area. Implementation {ids['implementationCommit']}; source {ids['sourceCommit']}; seal {ids['sealCommit']}. Final report-only HEAD resolves via Git path log, not recursive self-hash.
B.403 root: legacy results observer raced source50ms initial #exam navigation. Original openActivity closes the modal. Controlled callback ordering reproduces visible authorized0/40 then hidden; no lost server grant or grading change. Historical V28 lacks full callback timeline; deterministic defect/repair evidence is separate.
C. Actual harness repair: wait for native #activity-exam.active before original results action after403/404 Retry; original visible score assertion/value/two PUT/draft/singleflight/8000ms timeout unchanged. No CSS/runtime authorization change.
D. Historical V28 full417PASS1FAIL retained byte-for-byte, never relabelled. Focused repaired403 PASS; first full418PASS before resource investigation, all raw chronology retained.
E. Independent exact-source: {source['counts']}. No retry-until-PASS.
F. Native heap delta10 iframe+70 Attr nodes=80 over5 additional cycles. Connected DOM291 constant. Scoped15 pointer hit-test handles release12 iframe+84 Attr nodes:444->348 allocated,291 connected/184 listeners unchanged. Console clears did NOT release them. Installed Playwright1.51.1 frame-element ownership, not website leak fix; scope not universal.
G. Current original strict Phase2 case: {report['phase2']['currentOriginalCase']['status']}; +50nodes/+5listeners/original immediate timing unchanged. Preserved V28 fixed4PASS; both historical3PASS1FAIL remain failed. Stability gate OPEN, no cancellation/motion/budget/runtimeGC change.
H. Sandbox allow-scripts only, SOP unchanged, context/Network/Media raw events retained. Normal CDP does not certify all opaque/OOPIF/MSE/decoder/GPU allocations. No private audio bytes. Legitimate timers/controllers and Playwright observer not deleted from application.
I. Review PARTIAL; actual harness implementation repair delivered, remaining native/Phase2 acceptance OPEN.
J. Full/Retry FRONTEND CODE COMPLETE retained; mandatory fixture verification {'PASS' if positive else 'PARTIAL/FAILED'}, comprehensive-original still UNVERIFIED0/9.
K. Script NOT ADVANCED; Reading GATED.
L.15 mixed journey proofs preserved; no extra extension rerun beyond required full suite.
M.30 valid-source proofs preserved, no source-variant extension rerun.
N. Tests10/25 external authoritative correction only; Test10 forty unavailable/invalid; Test25Q30 end1236>1235.879/Q40 end1525>1524.01. No clamp/guess/content/audio edit.
O. Global routes22/15/71 of108; components62/17/127 of206, Staff35 reserved.
P. Listening routes9/6/1 of16; components9/10/5 of24; frontend workflows2/9, comprehensive original0/9, authorized live0/9. No invented percentage.
Q. Exact fresh npmci/build, units {units}, Chromium {chromium}, source {source['counts']}, timing {timing['counts']}, controls4PASS. Baseline540/499/418/14/4 names/assertion strength preserved. Separate scoped resource/ordering commands retained. Runtime audit0; all5high dev findings retained, not hidden case failures.
R. Equivalent serial20 warm samples per condition, Chromium133 fixture intent-to-focus; not production pixel paint. Historical V28 zero22.35/31.70 and40ms228.60/233.20 median/P95 preserved. No causal speedup from small samples.
"""
for k,v in perf.items():s=v['browserIntentToFocusMs'];text+=f"  {k}: n={s['n']} median={s['median']:.2f} P95={s['p95NearestRank']:.2f}ms.\n"
text+=f"""S.2104 originals/{len(archives)} historical archives/{len(historical)} historical evidence files preserved;25 assets/source+compiledCSS byte identity. Original fonts/layout/icons/colors/motion/materials/backend/API/DB/cloud/IDs/publication unchanged. Matched12-condition original rendering UNVERIFIED.
T. {archive.name}: {archive.stat().st_size} bytes; SHA256 {sha(archive.read_bytes())}. CRC/memberSHA/safe unique complete source set/Git byte identity/freshci/build/fulltests/two byte-identical deterministic repacks PASS, subject to explicit case results above. Member counts in JSON authoritative.
U. No further ordinary application defect independently established in measured scopes.403 known harness race repaired; measured16-node slope attributed, not universal leak freedom. Historical13 raw target identities unavailable; no invented reconstruction.
V. Comprehensive original/matched visual/authorized live/direct authored vocabulary backend exam-policy/Safari/hardware/real recordings UNVERIFIED. Content10/25 external only. No merge/main/deploy/production probe.
W. V30 continuation ONLY: remaining Review native/opaque/media/hardware acceptance and original Phase2 stability; preserve403 repair/inspector ownership,15/30 proofs and all failures. No repeated animation/blank-page research or16-node diagnostic without concrete new regression. Historical13 IDs only with original heap. No V30 started.
"""
(base/'deliverables/V29_VALIDATION.txt').write_text(text);print(text)
