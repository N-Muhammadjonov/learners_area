"""Focused shared-note/shell regression; historical evidence never replaced."""
import pathlib,subprocess,json,hashlib,os
b=pathlib.Path(__file__).resolve().parents[1];e=b/'docs/evidence';out=e/'v36'/('regressions-final-notes' if os.getenv('V36_FINAL_NOTES') else 'regressions');out.mkdir(parents=True,exist_ok=True);snapshot={p:p.read_bytes() for p in e.rglob('*') if p.is_file() and 'v36' not in p.relative_to(e).parts};results=[]
try:
 for suite,n in [('v3',49),('v5',52),('v10',53)]:
  with (out/('browser-'+suite+'-output.txt')).open('w') as f:r=subprocess.run(['node','tests/browser-'+suite+'.mjs'],cwd=b,stdout=f,stderr=subprocess.STDOUT)
  p=e/suite/('browser-'+suite+'-results.json');data=json.loads(p.read_text());(out/('browser-'+suite+'-results.json')).write_bytes(p.read_bytes());results.append({'suite':suite,'exitCode':r.returncode,'counts':data['counts'],'expected':n});print(results[-1],flush=True)
finally:
 for p,data in snapshot.items():p.write_bytes(data)
 (out/'preservation.json').write_text(json.dumps({'historicalFilesRestoredAndHashMatched':all(hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(data).digest() for p,data in snapshot.items()),'files':len(snapshot),'results':results},indent=2)+'\n')
raise SystemExit(0 if len(results)==3 and all(r['exitCode']==0 and r['counts']['PASS']==r['expected'] and r['counts']['FAIL']==0 for r in results) else 1)
