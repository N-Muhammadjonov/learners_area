#!/usr/bin/env python3
"""Sequential fixture verification; failed cases remain in raw reports.
No runtime GC policy, animation, assertion, budget or source-content changes.
"""
import pathlib,subprocess,os,json,shutil
base=pathlib.Path(__file__).resolve().parents[1];out=base/'docs/evidence/v27';out.mkdir(exist_ok=True)
original=os.environ.get('ORIGINAL_SOURCE_ROOT',str(base.parents[1]));saved={p:p.read_bytes() for p in (base/'docs/evidence').rglob('*') if p.is_file() and 'v27' not in p.parts};records=[]
def run(name,cmd,env=None):
 with (out/(name+'.txt')).open('w') as log:r=subprocess.run(cmd,cwd=base,env=os.environ|(env or {}),stdout=log,stderr=subprocess.STDOUT)
 records.append({'name':name,'exit':r.returncode});(out/'extension-executions.json').write_text(json.dumps(records,indent=2)+'\n');print(records[-1],flush=True)
def source(name,variant,kind):
 env={'ORIGINAL_SOURCE_ROOT':original,'ORIGINAL_VARIANT':str(variant),'TEST_FILTER':kind,'V27_SOURCE':'1'}
 if kind.startswith('V26'):env['V26_SOURCE']='1'
 run(name,['node','tests/browser-original-source-v11.mjs'],env)
 report=out/'original-behavior-v27.json';shutil.copy2(report,out/'variants'/(name+'.json'))
try:
 run('assets',['node','scripts/assets-css-v27.mjs']);run('timing',['node','scripts/performance-v27.mjs'])
 for version,port in [('V26',4178),('V27',4173)]:
  run('controls-'+version,['node','tests/browser-original-source-v11.mjs'],{'ORIGINAL_SOURCE_ROOT':original,'V22_SOURCE':'1','V22_BENCH':'1','TEST_FILTER':'V22 controlled','PREVIEW_URL':'http://127.0.0.1:'+str(port)})
  d=out/'performance'/version;d.mkdir(parents=True,exist_ok=True)
  for p in (base/'docs/evidence/v22').glob('controlled*.json'):shutil.copy2(p,d/p.name)
  shutil.copy2(base/'docs/evidence/v22/original-behavior-v22.json',d/'cases.json')
 (out/'variants').mkdir(exist_ok=True)
 for n in range(1,33):
  source('source-%02d-fourpart'%n,n,'V26 actual catalogue')
  if n not in (10,25):source('source-%02d-modal'%n,n,'V27 mixed Long')
finally:
 for p,b in saved.items():p.write_bytes(b)
