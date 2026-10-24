"""Preserve all previous evidence; run mandatory suites once on the current build."""
import pathlib, subprocess, os, json, shutil, hashlib, threading
from concurrent.futures import ThreadPoolExecutor
base=pathlib.Path(__file__).resolve().parents[1]; evidence=base/'docs/evidence'; out=evidence/os.environ.get('V37_VERIFY_OUTPUT','v37'); out.mkdir(parents=True,exist_ok=True)
saved={p:p.read_bytes() for p in evidence.rglob('*') if p.is_file() and not p.is_relative_to(evidence/'v37')}
commands=[]; command_lock=threading.Lock()
def run(name,args,env=None,report=None):
 with (out/(name+'.txt')).open('w') as f:r=subprocess.run(args,cwd=base,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT)
 row={'name':name,'args':args,'exit':r.returncode};commands.append(row)
 artifacts=[]
 for p in evidence.rglob('*.json'):
  if p.is_relative_to(evidence/'v37'):continue
  raw=p.read_bytes()
  if saved.get(p)==raw:continue
  dest=out/(name+'-artifacts')/p.relative_to(evidence);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw);artifacts.append({'path':str(p.relative_to(evidence)),'sha256':hashlib.sha256(raw).hexdigest()})
 (out/(name+'-artifacts.json')).write_text(json.dumps(artifacts,indent=2))
 if report and (evidence/report).exists():shutil.copy2(evidence/report,out/(name+'.json'));row['report']=name+'.json'
 with command_lock:(out/'commands.json').write_text(json.dumps(commands,indent=2))
 print(row,flush=True)
pool=ThreadPoolExecutor(max_workers=1); source_future=None
def source():
 env={'ORIGINAL_SOURCE_ROOT':str(base.parents[1])}|{f'V{i}_SOURCE':'1' for i in range(12,28)}
 run('actual-source-full',['node','tests/browser-original-source-v11.mjs'],env,'v27/original-behavior-v27.json')
try:
 run('units',['npm','test'])
 if os.environ.get('V37_PARALLEL_SOURCE'):source_future=pool.submit(source)
 for file,report in [('browser.mjs','browser-results.json')]+[(f'browser-v{i}.mjs',f'v{i}/browser-v{i}-results.json') for i in range(2,12)]:run(file[:-4],['node','tests/'+file],report=report)
 run('encoded-media',['node','tests/browser-v11.mjs'],{'V12_MEDIA':'1','TEST_FILTER':'V12'},'v12/browser-v12-results.json')
 if source_future:source_future.result()
 else:source()
 run('timing',['node','scripts/performance-v33.mjs'],report='v33/timing/browser-v2-results.json')
 run('assets',['node','scripts/assets-css-v33.mjs'],report='v33/assets-css.json')
 # Four original equivalent controls are kept in the original V22 module.
 run('equivalent-controls',['node','tests/browser-original-source-v11.mjs'],{'ORIGINAL_SOURCE_ROOT':str(base.parents[1]),'V22_SOURCE':'1','V22_BENCH':'1','TEST_FILTER':'V22 controlled'},'v22/original-behavior-v22.json')
finally:
 pool.shutdown(wait=True)
 for p,data in saved.items():p.write_bytes(data)
 (out/'historical-evidence-preservation.json').write_text(json.dumps({'files':len(saved),'equal':all(p.read_bytes()==data for p,data in saved.items())},indent=2))
if any(row['exit']!=0 for row in commands):raise SystemExit(1)
