#!/usr/bin/env python3
"""V33 final report from independently extracted executions; no synthetic PASS."""
import pathlib,json,hashlib,subprocess,re,collections,math,statistics,zipfile
repo=pathlib.Path('/home/user/learners_area');base=repo/'migration/vanilla-frontend';w=pathlib.Path('/home/user/v33-independent');e=w/'executed-evidence'
def load(p):return json.loads(p.read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a])
old=load(base/'deliverables/V32_VERIFICATION.json');ids=load(w/'identities.json');extraction=load(w/'extraction.json');archive=base/'deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V33.zip';assert sha(archive.read_bytes())==extraction['archiveSHA256']
assert archive.with_suffix('.zip.sha256').read_text()==sha(archive.read_bytes())+'  '+archive.name+'\n'
assert sha(git('show',ids['sealCommit']+':migration/vanilla-frontend/deliverables/'+archive.name))==sha(archive.read_bytes())
assert git('show',ids['sealCommit']+':migration/vanilla-frontend/deliverables/'+archive.name+'.sha256')==archive.with_suffix('.zip.sha256').read_bytes()
for row in extraction['members']:
 commit=ids['sealCommit'] if row['path'] in ['SHA256SUMS','docs/FILE_MANIFEST.md'] else ids['sourceCommit'];assert sha(git('show',commit+':migration/vanilla-frontend/'+row['path']))==row['sha256'],row['path']
original=(w/'extracted/tests/browser-v6.mjs').read_text();driver=(w/'extracted/tests/phase2-v31.mjs').read_text();reconstructed=driver.replace('../docs/evidence/v31/phase2/','../docs/evidence/v6/')
a=original.index('async function check(');z=original.index('\nasync function fixture',a);x=reconstructed.index('async function check(');y=reconstructed.index('\nasync function fixture',x);reconstructed=reconstructed[:x]+original[a:z]+reconstructed[y:]
a=original.index("await check('Phase2 repeated");o=original.index('assert(await page.evaluate',a);z=original.index("fs.writeFileSync(new URL('phase2-performance.json'",o);x=reconstructed.index('try{assert(await page.evaluate',reconstructed.index("await check('Phase2 repeated"));y=reconstructed.index("fs.writeFileSync(new URL('phase2-performance.json'",x);reconstructed=reconstructed[:x]+original[o:z]+reconstructed[y:];assert reconstructed==original,'Original driver differs beyond declared repetition/output/after-assertion wrappers'
unit=(w/'unit.txt').read_text();units={k:int(re.search(r'^# '+k+r' (\d+)$',unit,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped']};assert units['tests']==544
prior=next(r['text'] for r in old['rawExecutionLogs'] if r['name']=='unit.txt');assert collections.Counter(re.findall(r'^# Subtest: (.*)$',prior,re.M))==collections.Counter(re.findall(r'^# Subtest: (.*)$',unit,re.M))
browser=[]
for p in old['executedReports']:
 current=load(e/'baseline-chromium'/(p['name']+'-regression.json'));assert [r['name'] for r in current['results']]==[r['name'] for r in p['data']['results']];browser.append({'name':p['name'],'data':current})
chromium={k:sum(p['data']['counts'].get(k,0) for p in browser) for k in ['PASS','FAIL','SKIP']};assert sum(chromium.values())==499
source=load(w/'original-source-full.json');assert [r['name'] for r in source['results']]==[r['name'] for r in old['originalSourceReport']['results']];assert sum(source['counts'].values())==418
candidates=list((e/'timing').glob('*results*.json'));assert len(candidates)==1;timing=load(candidates[0]);assert [r['name'] for r in timing['results']]==[r['name'] for r in old['timingReport']['results']]
preserved=[]
for row in old['outsideMigrationManifest']:assert sha((repo/row['path']).read_bytes())==row['sha256'];preserved.append(row)
archives=old['historicalArchives']+[{'path':'migration/vanilla-frontend/deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V32.zip','bytes':old['archive']['bytes'],'sha256':old['archive']['sha256']}]
for row in archives:
 assert (repo/row['path']).stat().st_size==row['bytes'];assert sha((repo/row['path']).read_bytes())==row['sha256']
 with zipfile.ZipFile(repo/row['path']) as z:assert z.testzip() is None
 row['CRC']='PASS';p=repo/row['path'];sidecar=p.with_suffix('.zip.sha256')
 if sidecar.exists():assert sidecar.read_text()==row['sha256']+'  '+p.name+'\n';row['sidecar']='PASS'
 else:assert p.parent.name!='deliverables';row['sidecar']='No preexisting sidecar required for original import archive'
historical=[]
for row in git('ls-tree','-r','b09c0e73c15b3adaf6fc9d8ab4f40cf9cbd42325','migration/vanilla-frontend/docs/evidence/').decode().splitlines():
 header,name=row.split('\t',1);oid=header.split()[2];b=(repo/name).read_bytes();assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==oid;historical.append({'path':name,'sha256':sha(b)})
unchangedTests=not git('diff','--diff-filter=MDT','--name-only','b09c0e73c15b3adaf6fc9d8ab4f40cf9cbd42325',ids['sourceCommit'],'--','migration/vanilla-frontend/tests').strip();assert unchangedTests
changed=git('diff','--name-only','b09c0e73c15b3adaf6fc9d8ab4f40cf9cbd42325',ids['sourceCommit'],'--','migration/vanilla-frontend/js','migration/vanilla-frontend/modules','migration/vanilla-frontend/css','migration/vanilla-frontend/fonts','migration/vanilla-frontend/brand','migration/vanilla-frontend/images').decode().splitlines();assert changed==[]
repacks=[]
for i in range(2):
 r=subprocess.run(['python3','scripts/package-v33.py'],cwd=w/'extracted',capture_output=True,text=True);assert r.returncode==0,r.stderr;p=w/'extracted/deliverables'/archive.name;assert p.read_bytes()==archive.read_bytes();repacks.append({'run':i+1,'sha256':sha(p.read_bytes()),'byteIdentical':True})
def stats(xs):
 s=sorted(xs);return {'n':len(xs),'median':statistics.median(xs),'p95NearestRank':s[math.ceil(.95*len(s))-1],'raw':xs}
perf={};controls={}
for version in ['V32','V33']:
 controls[version]=load(w/'performance'/version/'cases.json');assert [r['name'] for r in controls[version]['results']]==[r['name'] for r in old['controlledBenchmarkCases']['V32']['results']]
 for delay in [0,40]:
  raw=load(w/'performance'/version/('controlled-'+str(delay)+'.json'));assert len(raw['samples'])==20;perf[version+'-'+str(delay)]={'rawReport':raw,**{k:stats([r[k] for r in raw['samples']]) for k in raw['samples'][0] if all(isinstance(r.get(k),(int,float)) and not isinstance(r[k],bool) for r in raw['samples'])}}
commands=load(w/'commands.json');positive=all(r['exit']==0 for r in commands if r['name']!='audit-all') and units['pass']==544 and units['skipped']==0 and chromium=={'PASS':499,'FAIL':0,'SKIP':0} and source['counts']=={'PASS':418,'FAIL':0,'SKIP':0} and timing['counts']=={'PASS':14,'FAIL':0} and all(c['counts']=={'PASS':2,'FAIL':0,'SKIP':0} for c in controls.values())
phase=next(r for b in browser for r in b['data']['results'] if r['name']=='Phase2 repeated real content navigation retains shell and bounded DOM/listeners')
failed=[r for r in source['results'] if r['status']!='PASS'];status=old['status'].copy();status['fixtureVerification']='PASS' if positive else 'PARTIAL/FAILED'
assert positive,'Mandatory result is not PASS: preserve failure and write bounded causal plan before any expansion.'
authority=load(base/'docs/evidence/v33/release-authority.json');assert authority['approvedRule'] is None and authority['existingPhase2Approval'] is None
matrix=load(base/'docs/evidence/v33/acceptance-status.json')
for row in matrix['decisions']:
 if row['id']=='D':row['state']='PASS: fresh exact V33 packaged544/499/418/14/4;0FAIL0SKIP';row['missingCondition']='None for mandatory fixture scope';row['evidence']='Fresh exact V33 reports/raw logs in this verification JSON, original case names and test bytes preserved.'
 if row['id']=='E':row['state']=phase['status'];row['evidence']='Fresh original unchanged case inside499 and original immediate-stage counters; not aggregate release approval.'
status.update({'Review':'PARTIAL','Script':'NOT ADVANCED','Reading':'GATED','fixtureVerification':'PASS','releaseAcceptance':'EXTERNAL RELEASE ACCEPTANCE BLOCKED'})
nexttask=(base/'docs/V33_REMAINING_EXTERNAL_DECISIONS.md').read_text().split('## Exact V34 continuation task\n\n',1)[1].strip()
report={'checkpoint':'V33','checkpointKind':'BLOCKED acceptance checkpoint; evidence/tooling only, no new runtime implementation progress','branch':'arena/96836bcf-learners-area',**ids,'reportCommit':'SELF: git log -1 -- migration/vanilla-frontend/deliverables/V33_VERIFICATION.json','baseline':load(base/'docs/evidence/v33/baseline.json'),'archive':{'name':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes()),'sourceMembers':len(extraction['members'])-2,'generatedMembers':2},'independentExtraction':extraction,'allZIPMembersGitByteIdentity':True,'twoIdenticalRepacks':repacks,'commands':commands,'units':units,'chromium':chromium,'executedReports':browser,'originalSource':source['counts'],'originalSourceReport':source,'failedOriginalSourceCases':failed,'timingReport':timing,'controlledBenchmarkCases':controls,'performance':perf,'historicalV32Performance':old['performance'],'performanceLimitations':old['performanceLimitations'],'reusedV32CriteriaAudit':{'criteriaSearch':old['criteriaSearch'],'configScriptSupplement':old['supplementaryConfigScriptCriteriaAudit'],'GitHubSupplement':old['supplementaryGitHubCriteriaAudit'],'newRepositoryWideSearch':False},'releaseAuthority':authority,'ownerDecisionRequest':(base/'docs/V33_PHASE2_OWNER_DECISION_REQUEST.md').read_text(),'catalogueAcceptanceHandoff':load(base/'docs/evidence/v33/catalogue-handoff.json'),'acceptanceMatrix':matrix,'phase2':{'perRunCriterion':'Original same shell,+50nodes/+5listeners at original stage, tests/browser-v6.mjs:53 unchanged','currentOriginalCase':phase,'currentOriginalCounters':load(e/'baseline-chromium/phase2-original-case-performance.json'),'releaseStatus':'OPEN','releaseDecision':'EXTERNAL RELEASE ACCEPTANCE BLOCKED; EXTERNAL CRITERION REQUIRED;12/12 not automatically sufficient or insufficient','approvedRule':None,'approval':None,'additionalDiagnosticRuns':0,'historicalV31Series':old['phase2']['historicalV31Series'],'historyRule':'All V26 failures and both V27 3PASS1FAIL remain failed; V28fourPASS,V29/V30 originals,V31twelve,V32original kept separate. No historical rewriting, supersession rule or native exclusion invented.'},'remainingGates':(base/'docs/V33_REMAINING_EXTERNAL_DECISIONS.md').read_text(),'runtimeChanges':changed,'newDemonstratedApplicationDefects':[],'runtimeRepair':None,'status':status,'inventory':old['inventory'],'mixedLifecycleMatrixPreserved':old['mixedLifecycleMatrixPreserved'],'sourceVariantsPreserved':old['sourceVariantsPreserved'],'sourceVariantsRerun':False,'timingHandoff':old['timingHandoff'],'visualConditionEvidencePreserved':old['visualConditionEvidencePreserved'],'outsideMigrationManifest':preserved,'historicalArchives':archives,'historicalEvidencePreserved':historical,'assetsCss':load(e/'assets-css.json'),'directOriginalAssets':load(base/'docs/evidence/v33/assets-css.json'),'externalLimitations':old['externalLimitations'],'audits':{k:load(w/f)['metadata']['vulnerabilities'] for k,f in [('runtime','audit-runtime.txt'),('all','audit-all.txt')]},'rawExecutionLogs':[{'name':p.name,'sha256':sha(p.read_bytes()),'text':p.read_text()} for p in sorted(w.glob('*.txt')) if p.name!='report-generation.txt'],'casePreservationProof':{'unitNames':544,'newUnitChecks':0,'chromiumNames':499,'sourceNames':418,'timingNames':14,'allPreexistingTestFilesByteIdenticalToV32':unchangedTests,'noBaselineCaseDeletion':True},'acceptanceCategories':{'implementation':'No new runtime change or demonstrated defect; evidence/tooling only','mandatoryFixtureRegression':'PASS','phase2PerRun':phase['status'],'phase2Release':'OPEN — EXTERNAL RELEASE ACCEPTANCE BLOCKED','applicationResources':'IMPLEMENTED AND VERIFIED in supported scoped observables','nativeUniversal':'NOT MEASURABLE WITH AVAILABLE TOOLS; no app-defect presumption','opaqueFrameTerminals':'SCOPED VERIFIED, not universal native-memory release','comprehensiveOriginal':'BLOCKED/UNVERIFIED0/9 — authoritative input required','previousAttemptAndPublication':'BLOCKED — current authorized context/access and original composite acceptance set unavailable','matchedOriginalVisual':'UNVERIFIED','authorizedLive':'BLOCKED/UNVERIFIED0/9','hardwareSafariOriginalRecordings':'UNVERIFIED'},'nextTask':nexttask,'finalHeadProof':'Resolve final report path commit, then verify clean git status and localHEAD=remote; literal recursive self-hash not possible.'}
optional={}
for name in ['v27/resources.json','v24/review-performance.json']:
 p=w/'changed-observations'/name
 if p.exists():optional[name]={'sha256':sha(p.read_bytes()),'data':load(p)}
report['freshExistingSuiteObservations']=optional
# Qualified member screening against V32 and unchanged known historical nested ZIPs.
prior={x['path']:x['sha256'] for x in report['baseline']['members']};known={x['sha256'] for x in old['finalArchiveScreening']['nestedCheckpointBodies']};new=[];modified=[];nested=[];hits=[];sensitive=[]
with zipfile.ZipFile(archive) as z:
 names=z.namelist()
 for info in z.infolist():
  n=info.filename;data=z.read(n);h=sha(data)
  if n not in prior:new.append({'path':n,'sha256':h,'bytes':len(data)})
  elif prior[n]!=h:modified.append(n)
  if data.startswith(b'PK\x03\x04'):assert h in known;nested.append({'path':n,'sha256':h,'unchangedKnownHistoricalBody':True})
  if any(t.startswith('.env') for t in pathlib.PurePosixPath(n).parts) or n.endswith(('.key','.pem','.sqlite','.db','.sql','.mp3','.wav','.flac')):sensitive.append(n)
  if len(data)<10000000 and not data.startswith((b'PK',b'\x89PNG',b'\xff\xd8')):
   for kind,pat in {'privateKey':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----','awsAccessKey':rb'AKIA[0-9A-Z]{16}','githubToken':rb'(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}'}.items():
    if re.search(pat,data):hits.append({'path':n,'kind':kind})
assert not sensitive and not hits and len(nested)==4
report['finalArchiveScreening']={'archiveSHA256':sha(archive.read_bytes()),'bytes':archive.stat().st_size,'members':len(names),'newMembers':new,'changedMembers':modified,'removedMembers':sorted(set(prior)-set(names)),'nestedCheckpointBodies':nested,'newNestedArchiveBodies':0,'sensitiveExtensionCandidates':sensitive,'credentialSignatureHits':hits,'V32toV33ByteDelta':archive.stat().st_size-old['archive']['bytes'],'limits':'Qualified filename/signature check is not a universal secret detector. Historical bodies were SHA-preserved, not deduplicated or recompressed. No private/original educational audio added.'}
(base/'deliverables/V33_VERIFICATION.json').write_text(json.dumps(report,indent=2)+'\n')
sections=[
('A',f"Branch arena/96836bcf-learners-area;tooling {ids['implementationCommit']};source {ids['sourceCommit']};seal {ids['sealCommit']};final report identity via git log -1 -- deliverables/V33_VERIFICATION.json. Clean local=remote checked after push, no recursive self-hash."),
('B','V32ZIP100238862bytes/2109members/SHA138fb550e9d28e4ec4ed266a6c53c8ea51f82dbf190646d88ac341cfaec69835 CRC/memberSHA/everyGitbyte verified. Initial local9a7d differed from required remote b09c0e73c15b3adaf6fc9d8ab4f40cf9cbd42325;359untracked files75144582bytes copied/hashed outside repo before samebranch normalFF. No destructive reset/clean/discard or force.'),
('C','Human project-owner acceptance role identified in existing OWNER-DOSSIER/manual QA pack; specific signer/delegation and accessible established migration signoff mechanism NOT identified. Demo Owner/GitHub ownership/task request are not inferred signing authority. Existing scoped DBapproval is not Phase2 authority.'),
('D','V33_PHASE2_OWNER_DECISION_REQUEST.md: owner-ready feature/assertion/chronology/failures/12of12/V32PASS/native/inspector/repairs/regressions/external gaps/A–J/conditional consequences and UNSIGNED explicit response block. Prepared2026-10-22, not an approval date. Ready for requester to route to actual owner; no fabricated external submission.'),
('E','Actual authorized release rule NOT OBTAINED. EXTERNAL RELEASE ACCEPTANCE BLOCKED. All missing policy values remain null/NOTPROVIDED; no new count, threshold, approver or approval.'),
('F',f"Original per-run case{phase['status']}; aggregate evidence cannot be graded under absent policy. V31twelve passes and V32original496→473 are neither automatically sufficient nor insufficient. Fresh original V33 invocation is mandatory inside499, not release authorization."),
('G','V26failed and instrumented variants, both V27fixed3PASS1FAIL, rejected cancellation remain failures. V28fourPASS,V29/V30 originalPASS,V31predefined12PASS,V32originalPASS separate, no pooled denominator/retroactive native exception.'),
('H','Additional authorized diagnostic observations:0. No new Phase2 series, blank-page/cancellation/inspector/resource investigation. Required original regression executed once; existing lifecycle assertions preserved.'),
('I','Application-owned resource cleanup implemented/scoped verified; existing modal owner/writers/barriers/media reused, equivalent disposed frames/requests/RAF/URLs0,audiopaused/unsourced,observer/timerbounds; legitimate shell/harness owners retained. No universal leak-freedom claim.'),
('J','Preserved skeleton→CSSAnimation→DocumentTimeline→HTMLDocument shortest paths219/232; remaining13rawtargets unknown without originalheap. Ineffective cancellation withdrawn. Playwright-owned pointer-hit-test handles444→348allocated/291stableconnected/184stablelisteners accepted; no repeated study/native budget exception invented.'),
('K','V33_CATALOGUE_ACCEPTANCE_HANDOFF.md +32 explicit metadata/source rows and9workflow rows: canonical source/storage binding,repository-vs-live publication distinction,own attempt gap,original presentationSHA,existing contract,owner,evidence,status. Comprehensiveoriginal0/9/live0/9 BLOCKED; synthetic fixtures do not certify live.'),
('L','Previous-attempt/composite acceptance BLOCKED. Existing own checkpoint/latest-started fallback is not an arbitrary historical selector. Need actual original expected workflow/contract and authorized own states, not fabricated attempts/IDs/endpoint. GETfallback may normalize checkpoint; no productionGET performed.'),
('M','Current authorized publication/sequence eligibility BLOCKED. Repository Test1 waiting-activation note and2–32canonicaldraft are not current live DB publication proof. Test11/22manifest vs runtime-storage distinctions documented, not overwritten or labelled demonstrated frontend defects.'),
('N','No new frontend defect demonstrated. Static metadata clarifications/unknown native resources/missing owner policy are not fabricated app defects.'),
('O','No application repair; evidence/tooling/documentation only. No duplicate writer/auth/media engine or speculative cleanup.'),
('P','V16 acknowledged exact-snapshot fence/pendingnewerbytes/debounce/ReviewJournal/singleflight/freshauthority/canonicalforeign/sourcefences/explicitRetryAdopt preserved. Both V14nativeExam-ready repairs retain8000ms/score/value/draft/twoPUT. No exactly-once/CAS/abortrollback guarantees.'),
('Q','15supported mixed lifecycle proofs preserved; no new entire additional matrix.'),
('R','30valid-source proofs preserved, no32of32claim or additional source-sweep rebuild.'),
('S','Tests10fortyinvalid/unavailable;25Q30end1236>1235.879,Q40end1525>1524.01. Existing42entry authoritative content/media-owner correction handoff preserved; no guess/clamp/audio/HTML/key/ID/publication edit.'),
('T','Full IELTS/Retry Weak Areas FRONTEND CODE COMPLETE;frontendworkflows2/9,comprehensiveoriginal0/9,authorizedlive0/9 separate.'),
('U','Review PARTIAL; Phase2OPEN—EXTERNAL RELEASE ACCEPTANCE BLOCKED. New ZIP/greenfixtures do not authorize promotion.'),
('V','Script NOT ADVANCED;Reading GATED.'),
('W','Unchanged globalroutes22/15/71,components62/17/127;Listeningroutes9/6/1,components9/10/5;Staff35reserved. No product-wide percentage.'),
('X',f"Fresh exact install/build/unit{units};Chromium{chromium};source{source['counts']};timing{timing['counts']};4controls{ {k:v['counts'] for k,v in controls.items()} };names/assertions/testbytes preserved. Runtimeaudit{report['audits']['runtime']};full/devaudit{report['audits']['all']},separate."),
('Y','No runtime change or performance-improvement claim. Existing fixture intent-to-focus20samplescondition raw distributions retained; freshmedian/P95below. Matched-original12-condition visual acceptance UNVERIFIED;25asset/sourceCSS/compiledCSSidentity≠pixelproof;Safari/hardware/originalrecordingsUNVERIFIED.'),
('Z','2104originaltrackedfiles unchanged;no backend/auth/API/DB/Supabase/R2/Workers/grading/content/answers/transcripts/recordings/canonicalID/publication edits. sandboxallow-scriptsONLY/CSP/256KiBRange/8MiBLRU/max2transports/MSErecovery/Blobfallback preserved; direct vocabularybackendpolicyGPTWorkUNVERIFIED;no productionprobe/mainmerge/deploy.'),
('AA',f"{archive.name}:{archive.stat().st_size}bytes/SHA256{sha(archive.read_bytes())}/{len(extraction['members'])}safeunique members. CRC/allmemberSHA/Git source-seal/freshci/build/allmandatorysuites/twoidenticalrepacks/sidecarPASS. {len(archives)}priorarchives/{len(historical)}evidenceGitbytes preserved. Growth{archive.stat().st_size-old['archive']['bytes']}bytes;new{len(new)}/changed{len(modified)}/removed{len(report['finalArchiveScreening']['removedMembers'])};0newnested/fourhistoricalbodiesunchanged;qualifiedsensitive/signatures0,not universal secretdetection."),
('AB','Remaining executable frontend work: preserve exact baselines and investigate only a newly demonstrated failure through existing owner; none currently. Once authorized original states/rule are supplied, bounded contract-mapped QA may become executable. Do not manufacture functionality or new trials to fill external waiting time.'),
('AC','Owner A–J policy/identity/delegation/datedversion/explicitdecision;canonical source/catalogue/publication/sequence/own historical-context and expectedoriginal workflow;matchedrenders/livepermission/backendpolicy/device/media and original13targetevidence, each precisely handed off. No approval from silence.'),
('AD',nexttask)]
text='V33 — BLOCKED acceptance checkpoint; mandatory fixture PASS; EXTERNAL RELEASE ACCEPTANCE BLOCKED;Review PARTIAL;no runtime change\n'
for label,value in sections:
 text+=label+'. '+value+'\n'
 if label=='Y':
  for k,v in perf.items():t=v['browserIntentToFocusMs'];text+=f"  {k}:n={t['n']},median={t['median']:.2f}ms,P95={t['p95NearestRank']:.2f}ms.\n"
(base/'deliverables/V33_VALIDATION.txt').write_text(text);print(text)
