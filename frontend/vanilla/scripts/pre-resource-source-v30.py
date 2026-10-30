import pathlib,subprocess,os,shutil,json
b=pathlib.Path(__file__).resolve().parents[1];out=b/'docs/evidence/v30';saved={p:p.read_bytes() for p in (b/'docs/evidence').rglob('*') if p.is_file() and 'v30' not in p.parts}
env=os.environ|{'ORIGINAL_SOURCE_ROOT':str(b.parents[1]),'V27_SOURCE':'1'}|{f'V{i}_SOURCE':'1' for i in range(12,27)}
try:
 with (out/'repaired-full-source.txt').open('w') as f:r=subprocess.run(['node','tests/browser-original-source-v11.mjs'],cwd=b,env=env,stdout=f,stderr=subprocess.STDOUT)
 shutil.copy2(b/'docs/evidence/v27/original-behavior-v27.json',out/'repaired-full-source.json');(out/'repaired-full-command.json').write_text(json.dumps({'exit':r.returncode,'args':['node','tests/browser-original-source-v11.mjs'],'purpose':'Required full source afterV16 storage-ACK fence repair and BEFORE resource investigation'},indent=2));print(r.returncode,flush=True)
finally:
 for p,v in saved.items():p.write_bytes(v)
 for p in (b/'docs/evidence').rglob('*'):
  if p.is_file() and 'v30' not in p.parts and p not in saved:p.unlink()
