"""One real existing UI Script journey per valid source; never32/32 acceptance."""
import pathlib,os,subprocess,json
b=pathlib.Path(__file__).resolve().parents[1];out=b/'docs/evidence/v37';results=[]; prefix=os.environ.get('V37_SOURCE_OUTPUT_PREFIX','')
for n in range(1,33):
 if n in [10,25]:
  results.append({'source':n,'status':'BLOCKED','reason':'Authoritative mapping defect; preserve safe unavailable'});continue
 report=f'{prefix}script-source-{n:02}.json'
 with (out/f'{prefix}script-source-{n:02}.txt').open('w') as f:r=subprocess.run(['node','tests/browser-original-source-v11.mjs'],cwd=b,env=os.environ|{'ORIGINAL_SOURCE_ROOT':str(b.parents[1]),'ORIGINAL_VARIANT':str(n),'V37_SOURCE':'1','V37_SOURCE_REPORT':report,'TEST_FILTER':'V37 Script 1440 en day'},stdout=f,stderr=subprocess.STDOUT)
 data=json.loads((out/report).read_text()) if (out/report).exists() else {}
 results.append({'source':n,'status':'PASS' if r.returncode==0 and data.get('counts',{}).get('PASS')==1 else 'FAIL','exit':r.returncode,'report':report,'counts':data.get('counts')});print(results[-1],flush=True)
 (out/(prefix+'script-source-matrix.json')).write_text(json.dumps({'scope':'One1440ENday original-source Script journey where source supports it. Source8 has no Script: safe-unavailable and Matching history tested, not Script credit. APIs/own result/media synthetic. NOT comprehensive original acceptance. Test10/25blocked, not skipped or corrected.','results':results},indent=2)+'\n')
