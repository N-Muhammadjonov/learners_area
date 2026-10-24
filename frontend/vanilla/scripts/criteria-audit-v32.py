#!/usr/bin/env python3
"""Read-only requirements search/provenance. Does not run a browser or set acceptance policy."""
import pathlib,subprocess,json,hashlib,re
b=pathlib.Path(__file__).resolve().parents[1];r=b.parents[1];out=b/'docs/evidence/v32';out.mkdir(parents=True,exist_ok=True)
sha=lambda x:hashlib.sha256(x).hexdigest()
baseline='cf5df0d8bce7e8b22a203a7458a4ac54e787f3d6'
def gitbytes(n):return subprocess.check_output(['git','-C',str(r),'show',baseline+':'+n])
files=subprocess.check_output(['git','-C',str(r),'ls-tree','-r','--name-only','-z',baseline]).decode().split('\0');rows=[]
pattern=re.compile(r'phase.?2|stabil|acceptance|resource|cleanup|leak|sample|repet|round|opaque|complete',re.I)
for n in files:
 p=r/n
 eligible=(n.startswith('docs/') or n.startswith('tests/') or n.startswith('migration/vanilla-frontend/docs/') or n.startswith('migration/vanilla-frontend/tests/') or n=='migration/vanilla-frontend/README.md')
 if not eligible or '/evidence/' in n or '/deliverables/' in n or p.suffix not in ['.md','.txt','.json','.mjs','.ts','.tsx'] or p.name=='FILE_MANIFEST.md':continue
 data=gitbytes(n);text=data.decode('utf8',errors='replace');lines=text.splitlines();hits=[{'line':i+1,'lineSHA256':sha(s.encode())} for i,s in enumerate(lines) if pattern.search(s)];rows.append({'path':n,'sha256':sha(data),'lines':len(lines),'matchingLines':hits})
selected={
 'original-strict':('migration/vanilla-frontend/tests/browser-v6.mjs','Phase2 repeated real content navigation'),
 'original-bounded-scope':('migration/vanilla-frontend/docs/CHECKPOINT_V6.md','Bounded short run'),
 'application-cleanup-test':('migration/vanilla-frontend/tests/original-review-v27-journeys.mjs','V27 six Review source route cycles'),
 'application-cleanup-scope':('migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md','Each of six route-disposed'),
 'shell-owner-exceptions':('migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md','two remaining timeout'),
 'native-thirteen':('migration/vanilla-frontend/docs/CHECKPOINT_V27.md','Other13 native detached'),
 'inspector-attribution':('migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md','Fifteen acquisitions'),
 'native-tool-limits':('migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md','Media.enable'),
 'frame-terminal-scope':('migration/vanilla-frontend/docs/V30_PHASE2_ASSESSMENT.md','New dirty-flush'),
 'snapshot-fence':('migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md','Authored parent checkpoint ACK'),
 'canonical-fences':('migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md','At most two rounds'),
 'comprehensive-open':('migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V21.md','Previous-attempt selector'),
 'earlier-executable-gates':('migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md','whole-catalogue'),
 'v31-series-not-policy':('migration/vanilla-frontend/docs/V31_PHASE2_RESULTS.md','No existing finite-run'),
 'v31-plan-sample-scope':('migration/vanilla-frontend/docs/V31_PHASE2_DECISION_PLAN.md','Existing gate was explicitly OPEN'),
 'root-package-identity':('docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt','Current product feature branch'),
 'root-package-rounds':('docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt','Run browser acceptance twice'),
 'root-package-navigation':('docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt','Performance three cold/warm rounds'),
 'root-package-phase2':('docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt','PHASE 2 — Navigation/performance'),
 'root-package-webrtc':('docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt','resource cleanup'),
 'visual-evidence-limit':('migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md','CSS identity proves bytes'),
 'external-timing':('migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V31.md','Test10 forty'),
 'original-runtime-baseline':('docs/RUNTIME-STABILITY-ARCHITECTURE.md','Runtime starting SHA'),
 'original-runtime-authority':('docs/RUNTIME-STABILITY-ARCHITECTURE.md','cached data never decides'),
 'original-runtime-testing':('docs/RUNTIME-STABILITY-ARCHITECTURE.md','tests/runtime-stability.test.ts'),
 'original-resource-map':('docs/RUNTIME-RESOURCE-MAP.md','Measurements: local'),
 'original-reading-scope':('docs/READING-PRODUCTION-STABILITY.md','Reading production stability'),
 'riwi-stability-scope':('docs/arena/LEARNERS_AREA_ARENA_COMPLETE_NO_BACKGROUND_RIWI_SUPER_MASTER_META_PROMPT_2026_10_08.txt','38.10 — STABILITY'),
 'status-contract':('migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md','Review PARTIAL'),
}
citations={}
for key,(n,needle) in selected.items():
 data=gitbytes(n);text=data.decode();matches=[(i+1,s) for i,s in enumerate(text.splitlines()) if needle.lower() in s.lower()];assert matches,(key,n,needle);i,line=matches[0];citations[key]={'path':n,'line':i,'sha256':sha(data),'quote':line}
pdf=r/'docs/arena-package/2026-10-01/Arena_visual_evidence_2026-10-01_v2.pdf';pdftext=pathlib.Path('/home/user/v32-work/original-package-pdf-text.txt').read_text()
report={'scope':'All tracked root docs/tests text and migration docs/specifications/tests at V31, excluding generated FILE_MANIFEST, evidence trees and deliverables from broad search. Historical V26–V31 report JSONs/evidence separately inspected. Matching line hashes avoid copying unrelated product/content instructions. Exact relevant citations retained below.','baselineCommit':'cf5df0d8bce7e8b22a203a7458a4ac54e787f3d6','corpus':rows,'citations':citations,'pairedOriginalPackagePDF':{'path':str(pdf.relative_to(r)),'sha256':sha(pdf.read_bytes()),'pages':63,'extractionTool':'external pypdf6.1.1; no project dependencies changed','textSHA256':sha(pdftext.encode()),'relevantText':[l for l in pdftext.splitlines() if re.search(r'acceptance|phase|native|stabil|round',l,re.I)]},'authorityLimit':'Repository checkpoint statements are evidence/handoffs, not automatically signed release-owner policy. Current V32 user instructions are authoritative for scope; missing policy cannot be fabricated. Search cannot prove no policy exists outside this checkout/conversation.','finding':'Executable original per-run criteria found. No applicable Phase2 population/reliability threshold, historical-failure supersession rule, or universal native-release acceptance test found in searched material. EXTERNAL CRITERION REQUIRED. Original product two-browser/three-round specification belongs to different baseline/deployment and is not the +50/+5 Phase2 stability rule.'}
(out/'criteria-search.json').write_text(json.dumps(report,indent=2)+'\n');print('Searched',len(rows),'tracked text sources;',len(citations),'exact citations; paired PDF63pages inspected')
