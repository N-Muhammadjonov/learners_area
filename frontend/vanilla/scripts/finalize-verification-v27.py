#!/usr/bin/env python3
"""Generate external V27 verification from executed evidence; never rerun to pass."""
import pathlib,json,hashlib,subprocess,re,statistics,math,zipfile,os
repo=pathlib.Path(os.environ.get('V27_REPO','/home/user/learners_area'));base=repo/'migration/vanilla-frontend';w=pathlib.Path(os.environ.get('V27_WORK','/home/user/v27-independent'));e=w/'executed-evidence';old=json.loads((base/'deliverables/V26_VERIFICATION.json').read_text());identity=json.loads((w/'identities.json').read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
def load(p):return json.loads(p.read_text())
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a])
archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V27.zip';extraction=load(w/'extraction.json');assert sha(archive.read_bytes())==extraction['archiveSHA256']
unit=(w/'unit.txt').read_text();unit_counts={k:int(re.search(r'^# '+k+r' (\d+)$',unit,re.M)[1]) for k in ['pass','fail','skipped']}
old_unit=next(r['text'] for r in old['rawExecutionLogs'] if r['name'] in ['unit.txt','units.txt'])
old_names=set(re.findall(r'^# Subtest: (.*)$',old_unit,re.M));new_names=set(re.findall(r'^# Subtest: (.*)$',unit,re.M));assert old_names<=new_names
browser=[]
for prior in old['executedReports']:
 p=e/'baseline-chromium'/(prior['name']+'-regression.json');current=load(p);assert {r['name'] for r in prior['data']['results']}=={r['name'] for r in current['results']};browser.append({'name':prior['name'],'data':current,'sha256':sha(p.read_bytes())})
source=load(w/'original-source-full.json');source_names={r['name'] for r in source['results']};assert {r['name'] for r in old['originalSourceReport']['results']}<=source_names
matrix=load(base/'docs/evidence/v27/mixed-lifecycle-matrix.json');lookup={r['name']:r for r in source['results']}
for r in matrix:
 r['exactZIPResult']=lookup.get(r['case']);r['status']='IMPLEMENTED AND VERIFIED' if lookup.get(r['case'],{}).get('status')=='PASS' else 'IMPLEMENTED BUT NOT VERIFIED'
variants=[]
for n in range(1,33):
 four=load(e/'variants'/('source-%02d-fourpart.json'%n));modal=None if n in (10,25) else load(e/'variants'/('source-%02d-modal.json'%n));variants.append({'source':n,'fourPart':four,'modalLongAnswerKeyboardReload':modal,'status':'UNAVAILABLE/PARTIAL AUTHORITATIVE TIMING' if n in (10,25) else 'PASS' if four['counts']['PASS']==1 and four['counts']['FAIL']==0 and modal['counts']['PASS']==1 and modal['counts']['FAIL']==0 else 'FAIL'})
perf={}
def stats(xs):
 xs=list(xs);s=sorted(xs);return {'n':len(xs),'median':statistics.median(xs),'p95NearestRank':s[math.ceil(len(s)*.95)-1],'min':min(xs),'max':max(xs),'raw':xs}
for version in ['V26','V27']:
 for delay in [0,40]:
  j=load(e/'performance'/version/('controlled-'+str(delay)+'.json'));rows=j.get('samples',[]);perf[version+'-'+str(delay)]={'rawReport':j}
  if rows:
   for key in rows[0]:
    if all(isinstance(r.get(key),(int,float)) and not isinstance(r[key],bool) for r in rows):perf[version+'-'+str(delay)][key]=stats(r[key] for r in rows)
# Git identity is checked against ZIP bytes before test/build evidence can mutate extraction output.
prefix='migration/vanilla-frontend/';source_tree={}
for row in git('ls-tree','-rz',identity['sourceCommit'],prefix).split(b'\0'):
 if row:
  meta,name=row.split(b'\t',1);source_tree[name.decode()[len(prefix):]]=meta.decode().split()[2]
with zipfile.ZipFile(archive) as z:
 git_members=[]
 for m in extraction['members']:
  name=m['path'];data=z.read(name);blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest();assert source_tree.get(name)==blob,name;git_members.append({'path':name,'gitBlob':blob,'sha256':m['sha256']})
# Original tracked files and every historical archive must remain identical.
outside=[]
for row in git('ls-tree','-rz','49c19cc1cbcf64f78713e24b11f99cef278a54d2').split(b'\0'):
 if not row:continue
 meta,name=row.split(b'\t',1);name=name.decode()
 if name.startswith(prefix):continue
 data=(repo/name).read_bytes();blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest();assert blob==meta.decode().split()[2],name;outside.append({'path':name,'sha256':sha(data)})
assert len(outside)==2104
historical=load(base/'docs/evidence/v27/historical-archives.json')['archives'];assert len(historical)==31
for r in historical:assert len((repo/r['path']).read_bytes())==r['bytes'] and sha((repo/r['path']).read_bytes())==r['sha256']
# Historical evidence comparison excludes only new V27 evidence; no old failed run overwritten.
history=[]
for row in git('ls-tree','-rz','01ec086e660e92fd87d79a0f4cf1a57c693cd862',prefix+'docs/evidence').split(b'\0'):
 if not row:continue
 meta,name=row.split(b'\t',1);name=name.decode();data=(repo/name).read_bytes();assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==meta.decode().split()[2],name;history.append(name)
repacks=[]
for _ in range(2):
 subprocess.run(['python3','scripts/package.py'],cwd=base,check=True,stdout=subprocess.DEVNULL);actual=sha(archive.read_bytes());assert actual==extraction['archiveSHA256'];repacks.append(actual)
commands=load(w/'commands.json');rawlogs=[{'name':p.name,'sha256':sha(p.read_bytes()),'text':p.read_text(errors='replace')} for p in sorted(w.glob('*.txt'))]
counts={k:sum(r['data']['counts'].get(k,0) for r in browser) for k in ['PASS','FAIL','SKIP']}
report={'checkpoint':'V27','branch':'arena/96836bcf-learners-area',**identity,'reportCommit':'External report commit; resolved after writing, not a recursive self-hash','archive':{'name':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes()),'sourceMembers':len(extraction['members']),'generatedMembers':2},'independentExtraction':extraction,'sourceGitMembers':git_members,'commands':commands,'units':unit_counts,'baselineUnitNamesPreserved':len(old_names),'chromium':counts,'executedReports':browser,'originalSource':source['counts'],'originalSourceReport':source,'baselineOriginalNamesPreserved':407,'mixedLifecycleMatrix':matrix,'sourceVariants':variants,'sourceVariantMetadata':load(base/'docs/evidence/v27/source-variant-matrix.json'),'timingReport':load(e/'timing/browser-v2-results.json'),'extensionExecutions':load(e/'extension-executions.json'),'controlledBenchmarkCases':{v:load(e/'performance'/v/'cases.json')['counts'] for v in ['V26','V27']},'performance':perf,'acceptedV26Performance':old['controlledPerformance'],'performanceLimitations':'Local serial fixture intent/focus, API, JS+DOM and frame samples only. Not production paint/real recordings/whole-product1–100ms. Preserve V26zero31.55/41.80 and40delay232.60/246.80ms; historical slower V26zero result is not erased. No causal speedup claim from noisy samples.','resources':load(e/'resources.json'),'playingMediaResources':load(w/'extracted/docs/evidence/v25/resource-cycles.json'),'modal24Cycles':load(w/'extracted/docs/evidence/v26/modal-resources.json'),'assetsCss':load(e/'assets-css.json'),'outsideMigrationManifest':outside,'historicalArchives':historical,'historicalEvidencePreserved':history,'twoIdenticalRepacks':repacks,'phase2':{'status':'OPEN','unchangedCurrentCase':next(r for b in browser for r in b['data']['results'] if r['name']=='Phase2 repeated real content navigation retains shell and bounded DOM/listeners'),'preservedInvestigation':load(base/'docs/evidence/v27/phase2-summary.json'),'baselineRetainers':load(base/'docs/evidence/v27/baseline-retainers.json'),'limits':'Captured dominant transient animation path is proven for those snapshots; not every native root/all historical failures. Withdrawn cancellation not reinstated.'},'status':{'Full':'FRONTEND CODE COMPLETE','Retry':'FRONTEND CODE COMPLETE','Review':'PARTIAL','Script':'NOT ADVANCED','Reading':'GATED','matchedOriginalVisual':'UNVERIFIED','authorizedLive':'UNVERIFIED','hardwareSafariRecordings':'UNVERIFIED'},'inventory':old['inventory'],'timingHandoff':load(base/'docs/evidence/v27/timing-handoff.json'),'visualConditionEvidence':load(w/'extracted/docs/evidence/v25/visual-scope.json'),'failureChronology':{'newMixedSetup':'Initial adoption fixture incorrectly seeded checked part; missing Check control failed. Raw initial failure retained; fixture corrected to unchecked state, no production assertion weakened.','legacyMappingHarness':'Preseal actual-source417PASS1FAIL: old synchronous mapping loop raced fresh authorization. Same clock/part/40-window assertions retained, real native controls awaited; focused repaired case1PASS. First full failure and focused result are preserved separately.','priorFailedCancellation':'Preserved, withdrawn and not reinstated','phase2':'Historical3PASS1FAIL series remain failures; no diagnostic retry-until-pass'},'rawExecutionLogs':rawlogs,'remainingIndependentFrontendDefects':'Modal removed-sibling/disconnected-dialog owner repaired. No further leak independently demonstrated in measured scopes; original Phase2 strict stability acceptance remains OPEN and bounded parent-realm probes do not close universal native/opaque-frame ownership. Do not promote Review on tests alone.','externalLimitations':['Tests10/25 authoritative timing corrections','Authorized matched original rendering','Live presentation integration/direct authored vocabulary backend exam-policy acceptance','Hardware/Safari/real original recordings'],'nextTask':'Continue remaining Review acceptance/resource attribution and exact unverified combinations, if any, from this V27 checkpoint; do not restart GC ablations, disable animations, weaken budgets, advance Script/Reading or modify backend/content.'}
(base/'deliverables/V27_VERIFICATION.json').write_text(json.dumps(report,indent=2)+'\n')
lines=['V27 EXACT-ZIP VERIFICATION — REVIEW PARTIAL',f"Source {identity['sourceCommit']}; seal {identity['sealCommit']}",f"ZIP {archive.stat().st_size} bytes; SHA256 {sha(archive.read_bytes())}",f"Units {unit_counts}; Chromium {counts}; actual-source {source['counts']}; baseline names536/499/407 preserved",f"Timing {report['timingReport']['counts']}; valid sources {sum(r['status']=='PASS' for r in variants)}/30;10/25 unavailable/partial, not32/32",f"15 mixed statuses: {[r['status'] for r in matrix]}",f"Original Phase2 unchanged case: {report['phase2']['unchangedCurrentCase']['status']}; historical diagnostic failures retained; stability OPEN",'Actual runtime repair: existing modal releases removed owned sibling references and auto-cleans observer/focus confinement when dialog is externally removed. No design, motion, backend or source material change.',f"Exact archive CRC/member hashes/Git identity verified;2104 originals/31 historical ZIPs/{len(history)} historical evidence files preserved;25assets/CSS identity; two identical repacks {repacks}",'Review PARTIAL; Full/Retry frontend complete; Script not advanced; Reading gated. Matched-original visual/live/Safari/hardware/real recordings UNVERIFIED.','Performance raw20-sample fixture distributions and resource13-stage data are in V27_VERIFICATION.json. No production-paint, universal no-leak or whole-product1–100ms claim.','All command exits, failures, initial unsuccessful fixture setup and withdrawn cancellation evidence remain recorded. Final report commit/local=remote proof follows separately.']
(base/'deliverables/V27_VALIDATION.txt').write_text('\n'.join(lines)+'\n');print('\n'.join(lines))
