#!/usr/bin/env python3
"""Read-only archive provenance/composition; no exclusion or retention-policy change."""
import pathlib,zipfile,hashlib,json,collections,re,io
b=pathlib.Path(__file__).resolve().parents[1];out=b/'docs/evidence/v31';out.mkdir(parents=True,exist_ok=True)
def sha(x):return hashlib.sha256(x).hexdigest()
known={sha(p.read_bytes()):str(p.relative_to(b)) for p in (b/'deliverables').glob('*.zip')}
patterns={'privateKey':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----','awsAccessKey':rb'AKIA[0-9A-Z]{16}','githubToken':rb'(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}'}
def classify(n,data):
 if data.startswith(b'PK\x03\x04') and sha(data) in known:return 'historicalCheckpointBodies'
 if n.startswith('build/'):return 'generatedBuild'
 if '/evidence/' in n:return 'historicalEvidence'
 if n.startswith('deliverables/') and n.endswith(('.json','.txt')):return 'validationVerificationReports'
 if n.startswith(('fonts/','brand/','images/')):return 'requiredStaticAssets'
 return 'currentSourceToolingDocumentation'
reports={}
for v in ['V29','V30']:
 a=b/'deliverables'/f'LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_{v}.zip';groups=collections.defaultdict(lambda:{'members':0,'uncompressedBytes':0,'compressedBytes':0});members=[];nested=[];credentialHits=[];forbiddenNames=[]
 with zipfile.ZipFile(a) as z:
  assert z.testzip() is None
  for i in z.infolist():
   data=z.read(i.filename);h=sha(data);group=classify(i.filename,data);g=groups[group];g['members']+=1;g['uncompressedBytes']+=i.file_size;g['compressedBytes']+=i.compress_size;members.append({'path':i.filename,'sha256':h,'uncompressedBytes':i.file_size,'compressedBytes':i.compress_size,'category':group})
   if group=='historicalCheckpointBodies':
    with zipfile.ZipFile(io.BytesIO(data)) as inner:
     assert inner.testzip() is None
     innerNames=inner.namelist();innerSensitive=[n for n in innerNames if n.endswith(('.pem','.key','.sqlite','.db','.sql','.mp3','.wav','.flac')) or n.startswith(('content/listening/','private/','database/')) or any(t.startswith('.env') for t in pathlib.PurePosixPath(n).parts)]
     innerCredentialHits=[]
     for n in innerNames:
      d=inner.read(n)
      if len(d)<10_000_000 and not d.startswith((b'PK',b'\x89PNG',b'\xff\xd8')):
       for kind,pattern in patterns.items():
        if re.search(pattern,d):innerCredentialHits.append({'path':n,'kind':kind})
    nested.append({'member':i.filename,'sha256':h,'identicalRetainedArchive':known[h],'bytes':len(data),'compressedBytes':i.compress_size,'innerMemberCount':len(innerNames),'innerSensitiveCandidates':innerSensitive,'innerCredentialPatternHits':innerCredentialHits})
   if any(p.startswith('.env') for p in pathlib.PurePosixPath(i.filename).parts) or i.filename.endswith(('.pem','.key','.sqlite','.db','.sql','.mp3','.wav','.flac')):forbiddenNames.append(i.filename)
   if not data.startswith((b'PK',b'\x89PNG',b'\xff\xd8')) and len(data)<10_000_000:
    for name,pattern in patterns.items():
     if re.search(pattern,data):credentialHits.append({'path':i.filename,'kind':name})
 reports[v]={'archiveBytes':a.stat().st_size,'archiveSHA256':sha(a.read_bytes()),'groups':dict(groups),'containerHeadersBytes':a.stat().st_size-sum(i['compressedBytes'] for i in members),'members':members,'nestedKnownArchiveBodies':nested,'credentialPatternHits':credentialHits,'sensitiveExtensionCandidates':forbiddenNames,'directDeliverablesEntries':[m['path'] for m in members if m['path'].startswith('deliverables/')]}
a={m['path']:m for m in reports['V29']['members']};c={m['path']:m for m in reports['V30']['members']};added=[m for n,m in c.items() if n not in a];changed=[{'path':n,'compressedDelta':c[n]['compressedBytes']-a[n]['compressedBytes']} for n in a.keys()&c.keys() if a[n]['sha256']!=c[n]['sha256']];removed=[m for n,m in a.items() if n not in c]
delta=reports['V30']['archiveBytes']-reports['V29']['archiveBytes'];nestedBytes=sum(n['compressedBytes'] for n in reports['V30']['nestedKnownArchiveBodies']);assert delta==52881261
report={'scope':'Read-only provenance audit; no claim that pattern scanning proves absence of all secrets. Known nested archive hashes/CRC and Git-pinned source provenance determine classification.','archives':reports,'deltaBytes':delta,'addedMembers':added,'changedMembers':changed,'removedMembers':removed,'addedCompressedBytes':sum(m['compressedBytes'] for m in added),'changedCompressedDelta':sum(m['compressedDelta'] for m in changed),'removedCompressedBytes':sum(m['compressedBytes'] for m in removed),'containerHeadersDelta':reports['V30']['containerHeadersBytes']-reports['V29']['containerHeadersBytes'],'nestedCheckpointCompressedBytes':nestedBytes,'remainderAfterNestedBytes':delta-nestedBytes,'retentionPolicy':'Unchanged: deliverables excluded from source ZIP by existing packager. V30 includes four identical early checkpoint bodies under preservation hashes, not the V29 ZIP itself. Preserve them and all historical archives; a future approved lossless reference/content-addressed packaging format could deduplicate copies, with independently verified reconstruction and explicit policy approval. No exclusion implemented.'}
assert delta==report['addedCompressedBytes']+report['changedCompressedDelta']-report['removedCompressedBytes']+report['containerHeadersDelta']
(out/'archive-size-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['deltaBytes','nestedCheckpointCompressedBytes','remainderAfterNestedBytes']}));print('Credential candidate counts',[(v,len(r['credentialPatternHits']),len(r['sensitiveExtensionCandidates'])) for v,r in reports.items()])
