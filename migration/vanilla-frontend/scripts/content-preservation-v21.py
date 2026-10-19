#!/usr/bin/env python3
"""Read-only preservation gate against the accepted V19 Git tree. No imports/writes to source."""
import argparse, hashlib, json, pathlib, subprocess
p=argparse.ArgumentParser();p.add_argument('--repo',default=str(pathlib.Path(__file__).resolve().parents[3]));p.add_argument('--output',required=True);a=p.parse_args();repo=pathlib.Path(a.repo);base='ed2b12c62cd64d704f0515d055b171d616bebfc9';prefix='migration/vanilla-frontend/'
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args])
def sha(b):return hashlib.sha256(b).hexdigest()
rows=git('ls-tree','-rz',base).split(b'\0');outside=[]
for row in rows:
 if not row:continue
 meta,name=row.split(b'\t',1);name=name.decode();mode,kind,oid=meta.decode().split()
 if name.startswith(prefix):continue
 f=repo/name;assert f.is_file() and not f.is_symlink(),name
 data=f.read_bytes();actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest();assert actual==oid,'Outside migration changed: '+name
 outside.append({'path':name,'gitBlob':oid,'sha256':sha(data)})
changed=set(git('diff','--name-only',base,'--').decode().splitlines())|set(git('ls-files','--others','--exclude-standard').decode().splitlines());assert all(n.startswith(prefix) for n in changed),sorted(changed)
pins=json.loads((repo/prefix/'docs/evidence/v21/historical-archives.json').read_text());archives=[]
for r in pins['archives']:
 data=(repo/r['path']).read_bytes();assert len(data)==r['bytes'] and sha(data)==r['sha256'],r['path'];archives.append(r)
# Newly introduced educational source/bank/media files are not allowed. JSON evidence is metadata, not an import.
added=set(git('diff','--diff-filter=A','--name-only',base,'--').decode().splitlines())|set(git('ls-files','--others','--exclude-standard').decode().splitlines())
for name in added:
 f=pathlib.Path(name);assert f.suffix.lower() not in {'.html','.htm','.mp3','.wav','.ogg','.aac','.mp4','.csv','.tsv','.xlsx','.parquet','.ndjson','.jsonl','.sql'},'New content-like file: '+name
 assert not any(part.lower() in {'banks','corpus','datasets','transcripts','questions'} for part in f.parts),'New content directory: '+name
report={'status':'PASS','baseline':base,'scope':'All original tracked files outside migration byte-identical, including educational source, IDs, publication, HTML, audio, keys and infrastructure. No reconstruction/import.','outsideMigrationFiles':len(outside),'historicalArchives':archives,'newContentLikeFiles':0,'manualAdapterReview':'Changes limited to shell authority hints, existing opaque-host adapters, bounded metadata barrier, synthetic learner-state tests, packaging and evidence/docs. No educational material copied/recreated; original HTML read only by the existing source harness.','changedPaths':sorted(changed),'outsideMigrationManifest':outside,'limitation':'Preservation is not live publication/security acceptance or permission to reconstruct content.'}
pathlib.Path(a.output).write_text(json.dumps(report,indent=2)+'\n');print('PASS content preservation:',len(outside),'original files;',len(archives),'prior ZIPs; no new content-like files')
