#!/usr/bin/env python3
"""Build V28 external report strictly from retained executions and sealed bytes."""
import pathlib,json,hashlib,subprocess,re,math,statistics,zipfile
repo=pathlib.Path('/home/user/learners_area');base=repo/'migration/vanilla-frontend';w=pathlib.Path('/home/user/v28-independent');e=w/'executed-evidence';old=json.loads((base/'deliverables/V27_VERIFICATION.json').read_text());ids=json.loads((w/'identities.json').read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
def load(p):return json.loads(p.read_text())
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a])
archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V28.zip';extraction=load(w/'extraction.json');assert sha(archive.read_bytes())==extraction['archiveSHA256']
unit=(w/'unit.txt').read_text();units={k:int(re.search(r'^# '+k+r' (\d+)$',unit,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped']};assert units['tests']==540
prior=next(r['text'] for r in old['rawExecutionLogs'] if r['name'] in ['unit.txt','units.txt']);prior_names=set(re.findall(r'^# Subtest: (.*)$',prior,re.M));assert prior_names<=set(re.findall(r'^# Subtest: (.*)$',unit,re.M))
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
archives=old['historicalArchives']+[{'path':'migration/vanilla-frontend/deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V27.zip','bytes':old['archive']['bytes'],'sha256':old['archive']['sha256']}]
for row in archives:assert sha((repo/row['path']).read_bytes())==row['sha256']
historical=[]
for row in git('ls-tree','-r','7fd9877bd705d4342431fe2ce4e4e4ad0b2bc451','migration/vanilla-frontend/docs/evidence/').decode().splitlines():
 header,name=row.split('\t',1);oid=header.split()[2];b=(repo/name).read_bytes();assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==oid;historical.append({'path':name,'sha256':sha(b)})
changed=git('diff','--name-only','7fd9877bd705d4342431fe2ce4e4e4ad0b2bc451',ids['sourceCommit'],'--','migration/vanilla-frontend/js','migration/vanilla-frontend/modules','migration/vanilla-frontend/css','migration/vanilla-frontend/fonts','migration/vanilla-frontend/brand','migration/vanilla-frontend/images').decode();assert not changed
repacks=[]
for i in range(2):
 r=subprocess.run(['python3','scripts/package.py'],cwd=w/'extracted',capture_output=True,text=True);assert r.returncode==0,r.stderr
 p=w/'extracted/deliverables'/archive.name;assert p.read_bytes()==archive.read_bytes();repacks.append({'run':i+1,'sha256':sha(p.read_bytes()),'byteIdentical':True})
def stats(xs):
 s=sorted(xs);return {'n':len(xs),'median':statistics.median(xs),'p95NearestRank':s[math.ceil(.95*len(s))-1],'raw':xs}
perf={}
for version in ['V27','V28']:
 for delay in [0,40]:
  report=load(w/'performance'/version/('controlled-'+str(delay)+'.json'));rows=report['samples'];assert len(rows)==20;perf[version+'-'+str(delay)]={'rawReport':report,**{key:stats([r[key] for r in rows]) for key in rows[0] if all(isinstance(r.get(key),(int,float)) and not isinstance(r[key],bool) for r in rows)}}
logs=[{'name':p.name,'sha256':sha(p.read_bytes()),'text':p.read_text()} for p in sorted(w.glob('*.txt'))]
phase=load(base/'docs/evidence/v28/phase2-heap-v28-original/browser-v6-results.json');resources=load(e/'resources.json');timing=load(e/'timing/browser-performance.json') if (e/'timing/browser-performance.json').exists() else None
if timing is None:
 candidates=list((e/'timing').glob('*results*.json'));assert len(candidates)==1,candidates;timing=load(candidates[0])
report={'checkpoint':'V28','branch':'arena/96836bcf-learners-area',**ids,'reportCommit':'SELF: resolve git log -1 -- migration/vanilla-frontend/deliverables/V28_VERIFICATION.json','baseline':{'finalHead':'7fd9877bd705d4342431fe2ce4e4e4ad0b2bc451','sourceCommit':old['sourceCommit'],'sealCommit':old['sealCommit'],'archive':old['archive']},'archive':{'name':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes())},'independentExtraction':extraction,'allZIPMembersGitByteIdentity':True,'twoIdenticalRepacks':repacks,'commands':load(w/'commands.json'),'units':units,'baselineUnitNamesPreserved':len(prior_names),'chromium':chromium,'executedReports':browser,'originalSource':source['counts'],'originalSourceReport':source,'timingReport':timing,'controlledBenchmarkCases':{v:load(w/'performance'/v/'cases.json') for v in ['V27','V28']},'performance':perf,'historicalV27Performance':old['performance'],'performanceLimitations':old['performanceLimitations'],'phase2':{'status':'OPEN','fixedFourRun':phase,'historicalEvidence':old['phase2'],'matchedOwnershipLimit':'Historical13 raw identities absent; all fresh targets enumerated, native/inspector ownership not exclusively resolved.'},'resources':resources,'presealResources':load(base/'docs/evidence/v28/resources.json'),'freshRetainers':{p.name:load(p) for p in (base/'docs/evidence/v28').glob('heap-*-retainers.json')},'ownershipChronology':(base/'docs/evidence/v28/OWNERSHIP_CHRONOLOGY.md').read_text(),'applicationByteIdentityToV27':True,'implementation':'Diagnostic/harness/evidence only. No independently demonstrated new runtime lifecycle defect; no speculative application cleanup shipped. Native/opaque/inspection-sensitive retention remains unresolved acceptance work.','status':old['status'],'inventory':old['inventory'],'mixedLifecycleMatrixPreserved':old['mixedLifecycleMatrix'],'sourceVariantsPreserved':old['sourceVariants'],'sourceVariantsRerun':False,'timingHandoff':old['timingHandoff'],'visualConditionEvidencePreserved':old['visualConditionEvidence'],'outsideMigrationManifest':preserved,'historicalArchives':archives,'historicalEvidencePreserved':historical,'rawExecutionLogs':logs,'assetsCss':load(e/'assets-css.json'),'directOriginalAssets':load(base/'docs/evidence/v28/assets-css.json'),'externalLimitations':old['externalLimitations'],'nextTask':'V29 continuation only: precise native/opaque/inspection-sensitive ownership and16-node-per-cycle source probe growth; historical13 IDs only if original heap available. Preserve all15/30 proofs and strict failures. No V29 started.'}
(base/'deliverables/V28_VERIFICATION.json').write_text(json.dumps(report,indent=2)+'\n')
text=f'''V28 — exact sealed fixture verification; Review PARTIAL / Phase2 OPEN
A. Branch arena/96836bcf-learners-area. Implementation {ids['implementationCommit']}; source {ids['sourceCommit']}; seal {ids['sealCommit']}. Report commit self-resolves via Git path log; final response records final HEAD.
B. Diagnostic/harness/evidence implementation only; runtime application byte-identical to accepted V27, no claimed new runtime leak repair.
C. Fixed strict Phase2 four original runs4PASS/0FAIL; original +50/+5/immediate timing unchanged. Historical3PASS/1FAIL twice remains failed. Full regression original case independently retained, see raw Chromium reports. Gate OPEN.
D. Native transient retention is not permanent app leakage; paths are not exclusive dominators. Inspected/control immediate shell-disposal native counts differ285/173. No native runtime workaround.
E. Historical13 original heap targets cannot be individually recovered from absent raw heap. Fresh four heaps37 non-animation targets each exhaustively enumerated; one historical status path structurally corresponds, not identity proof.
F. Parent SOP denied opaque child access, contentDocument null; sandbox allow-scripts only. Normal frame/context events retained; not universal OOPIF/native release proof.
G. Four parent controllers: current route/shell/authority/notification refresh; shell exit leaves public route controller. Live timers authority expiry/module prewarm clear on shell exit; observed MO Playwright-owned. No intentional owners deleted.
H. Preseal13 Range response terminals12 aborted/1 finished; native Media events partial. Two held-body tests prove existing slots/read cancellation, not decoder/GPU memory. Sampled initial/peak/settled and16node/cycle growth retained in resource report; no flat/universal safety claim.
I. Review PARTIAL. Original Phase2 stability OPEN, native/opaque/measurement interference acceptance unfinished.
J. Accepted15 mixed journeys preserved, not extension-rerun.
K. Accepted30 valid-source proofs preserved, not extension-rerun. Full source suite mandatory below.
L. Test10/25 external authoritative content/media correction only; original mappings/audio unmodified.
M. Full/Retry FRONTEND CODE COMPLETE retained.
N. Script NOT ADVANCED; Reading GATED.
O. Routes22/15/71, components62/17/127; Listening routes9/6/1/components9/10/5; Staff35 reserved; frontend workflows2/9. No new completion credit.
P. Exact fresh npmci/build; units {units}; Chromium {chromium}; source {source['counts']}; timing {timing['counts']}; four benchmark control case outcomes in JSON.538 prior unit/499 browser/418 source names/assertion sources preserved;2 added body units. Failures are not rerun or hidden. All command statuses/raw outputs in JSON; audit-all separate.
Q. Controlled V27/V28 sequential20 samples per delay, raw and full limits in JSON. Fixture browser intent-to-focus, not production pixel-paint or whole-product speed. Historical V27 zero25.50/31.90 and40ms230.60/243.80 median/P95 preserved.
'''
for k,v in perf.items():s=v['browserIntentToFocusMs'];text+=f"  {k}: n={s['n']}, median={s['median']:.2f}, P95={s['p95NearestRank']:.2f}ms.\n"
text+=f'''R. CSS/fonts/assets/motion/layout/material/backend byte preservation, not matched original pixel proof.25 assets/source+compiled CSS unchanged; sandbox/CSP unchanged. No endpoints/live probes/production edits.
S. {archive.name}: {archive.stat().st_size}bytes, SHA256 {sha(archive.read_bytes())}. CRC/safe unique member hashes/all Git byte identity/freshci/build/full tests/two byte-identical repacks. {len(preserved)} originals/{len(archives)} old archives/{len(historical)} historical evidence files preserved. Source/seal/report distinct.
T. No new independently demonstrated application lifecycle defect repaired or hidden. Remaining demonstrable observation:16 allocated nodes/cycle in bounded resource probe and native/inspector-sensitive detached counts, owner not established; remain open rather than inventing defect/fix.
U. Comprehensive original, matched12-condition visual, authorized live/backend vocabulary exam policy, Safari/hardware/original recordings UNVERIFIED; frontend fixture tests are not those acceptances.
V. V29 continuation ONLY: pursue precise remaining native/opaque/inspection-sensitive owners and16node/cycle growth; historical13 only with original heap. Preserve15/30 proofs and failures; predefine bounded tests for concrete question, fix only demonstrated app defect. No V29 started, main merge or deployment.
'''
(base/'deliverables/V28_VALIDATION.txt').write_text(text);print(text)
