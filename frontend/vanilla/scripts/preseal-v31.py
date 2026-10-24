import pathlib,subprocess,os,json,shutil
b=pathlib.Path(__file__).resolve().parents[1];out=b/'docs/evidence/v31/preseal';out.mkdir(parents=True,exist_ok=True);saved={p:p.read_bytes() for p in (b/'docs/evidence').rglob('*') if p.is_file() and 'v31' not in p.parts};commands=[]
def run(name,args,env={}):
 with (out/(name+'.txt')).open('w') as log:r=subprocess.run(args,cwd=b,env=os.environ|env,stdout=log,stderr=subprocess.STDOUT)
 commands.append({'name':name,'args':args,'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2));print(commands[-1],flush=True);return r.returncode
try:
 for name,args,env in [('unit',['npm','test'],{}),('chromium',['node','scripts/regression-v31.mjs'],{}),('source',['node','tests/browser-original-source-v11.mjs'],{'ORIGINAL_SOURCE_ROOT':str(b.parents[1]),'V27_SOURCE':'1'}|{f'V{i}_SOURCE':'1' for i in range(12,27)}),('timing',['node','scripts/performance-v31.mjs'],{})]:
  status=run(name,args,env)
  if name=='source':shutil.copy2(b/'docs/evidence/v27/original-behavior-v27.json',out/'source.json')
  if status:raise SystemExit('New mandatory failure: no unrelated Phase2 expansion. Raw retained.')
 run('phase2',['node','tests/phase2-v31.mjs'])
finally:
 for p in (b/'docs/evidence').rglob('*'):
  if p.is_file() and 'v31' not in p.parts and p not in saved:
   q=b/'docs/evidence/v31/generated'/p.relative_to(b/'docs/evidence');q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());p.unlink()
 for p,data in saved.items():p.write_bytes(data)
