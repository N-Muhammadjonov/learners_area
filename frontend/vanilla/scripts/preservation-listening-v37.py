"""Compare original/archive/historical evidence bytes to the verified clean HEAD baseline."""
import pathlib,hashlib,json,subprocess
root=pathlib.Path(__file__).resolve().parents[3];b=root/'migration/vanilla-frontend';out=b/'docs/evidence/v37';groups={'originals':[],'archives':[],'historicalEvidence':[]};failed=[]
for entry in subprocess.check_output(['git','ls-tree','-r','-z','62076acc0178602c0bd87025f5c542510242bc1e'],cwd=root).split(b'\0'):
 if not entry:continue
 header,name=entry.split(b'\t',1);name=name.decode();oid=header.decode().split()[2];group='originals' if not name.startswith('migration/vanilla-frontend/') else 'archives' if name.endswith('.zip') else 'historicalEvidence' if '/docs/evidence/' in name else None
 if not group:continue
 p=root/name
 if not p.exists():failed.append(name);continue
 raw=p.read_bytes();digest=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest();groups[group].append({'path':name,'sha256':hashlib.sha256(raw).hexdigest(),'baselineGitBlob':oid,'equal':digest==oid})
 if digest!=oid:failed.append(name)
report={'baseline':'62076acc0178602c0bd87025f5c542510242bc1e','scope':'Byte preservation, not educational/content/media acceptance','status':'PASS' if not failed else 'FAIL','counts':{k:len(v) for k,v in groups.items()},'failures':failed,'newZIP':False,'groups':groups}
(out/'preservation.json').write_text(json.dumps(report,indent=2)+'\n');print({k:v for k,v in report.items() if k!='groups'});assert not failed
