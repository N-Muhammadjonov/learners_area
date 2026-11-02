#!/usr/bin/env python3
"""Install original lessons through the existing QA Owner's Safari session.

Only immutable Learners Area previews are accepted. The existing Owner candidate
-> approve -> promote API is used; conflicts are never automatically resolved.
No credentials or answer text are exported. One new test conversation is deleted.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"services/backend"))
from app.riwi_curriculum import installation_payload,source_checksum

FLOW_JS=r'''
const slot=__SLOT__,origin=__ORIGIN__,email=__EMAIL__,payload=__PAYLOAD__,checksum=__CHECKSUM__;
window[slot]={done:false};
(async()=>{
  const checks=[];
  let sourceId=null,created=null,active=false,blocked=null;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function check(name,ok){
    checks.push({name,passed:ok===true});
    if(!ok)throw new Error(name);
  }
  async function send(method,path,body){
    if(location.origin!==origin)throw new Error('wrong_origin');
    const base='/api/riwi/owner/knowledge';
    const allowed=(method==='GET'&&['/api/frontend/session','/api/riwi/owner/diagnostics',base].includes(path))||
      (method==='POST'&&[base,'/api/riwi/chat'].includes(path))||
      (sourceId&&((method==='GET'&&path===base+'/'+sourceId)||
        (method==='POST'&&[base+'/'+sourceId+'/approve',base+'/'+sourceId+'/promote'].includes(path))))||
      (created&&method==='DELETE'&&path==='/api/riwi/conversations/'+created);
    if(!allowed)throw new Error('unapproved_path');
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),20000);
    try{
      const options={method,credentials:'same-origin',redirect:'error',cache:'no-store',signal:ctrl.signal};
      if(body!==undefined){options.headers={'content-type':'application/json'};options.body=JSON.stringify(body);}
      const r=await fetch(path,options);let data=null;try{data=await r.json()}catch{}
      return {status:r.status,data};
    }finally{clearTimeout(timer);}
  }
  try{
    let r=await send('GET','/api/frontend/session');
    const user=r.data?.session?.user;
    check('expected_active_qa_owner',r.status===200&&user?.role==='owner'&&user?.accountStatus==='active'&&user?.email?.toLowerCase()===email);
    r=await send('GET','/api/riwi/owner/diagnostics');
    check('new_code_and_external_ai_disabled',r.status===200&&r.data?.rollout?.externalAi===false&&
      r.data?.rollout?.knowledgeIngestion===true&&r.data?.providers?.some(p=>p.id==='vercel'));
    r=await send('GET','/api/riwi/owner/knowledge');
    check('knowledge_list',r.status===200&&r.data?.ok===true&&Array.isArray(r.data.items));
    const sameTitle=r.data.items.filter(s=>s.title===payload.title);
    check('no_ambiguous_previous_source',sameTitle.length<=1);
    if(sameTitle.length===1){
      sourceId=sameTitle[0].id;check('existing_source_id',uuid.test(sourceId||''));
      r=await send('GET','/api/riwi/owner/knowledge/'+sourceId);
      check('existing_exact_source',r.status===200&&r.data?.source?.checksum===checksum);
    }else{
      r=await send('POST','/api/riwi/owner/knowledge',payload);
      sourceId=r.data?.source?.id;
      check('candidate_created',r.status===200&&uuid.test(sourceId||'')&&r.data?.source?.checksum===checksum&&
        r.data?.source?.unitCount===92&&r.data?.source?.conflictCount===0);
    }
    r=await send('GET','/api/riwi/owner/knowledge/'+sourceId);
    check('exact_source_before_review',r.status===200&&r.data?.source?.checksum===checksum&&r.data?.source?.unit_count===92);
    let state=r.data.source.state;
    if(state==='candidate'){
      r=await send('POST','/api/riwi/owner/knowledge/'+sourceId+'/approve',{});
      check('owner_approval',r.status===200&&r.data?.source?.state==='approved');state='approved';
    }
    if(state==='approved'){
      r=await send('POST','/api/riwi/owner/knowledge/'+sourceId+'/promote',{regressionFixtureId:'retrieval-active-scope-only-v1'});
      check('owner_promotion',r.status===200&&r.data?.source?.state==='active');state='active';
    }
    check('knowledge_active',state==='active');active=true;
    const topic='grammar.past-simple-vs-present-perfect',model='riwi-curriculum-v1:'+topic;
    r=await send('POST','/api/riwi/chat',{message:'Explain the difference between the past simple and present perfect.'});
    if(uuid.test(r.data?.conversationId||''))created=r.data.conversationId;
    check('grounded_bilingual_library_answer',r.status===200&&r.data?.ok===true&&created!==null&&
      r.data?.provenance==='approved_knowledge'&&r.data?.provider?.id==='riwi'&&r.data?.provider?.model===model&&
      Array.isArray(r.data?.citations)&&r.data.citations.some(c=>c.sourceId===sourceId)&&
      typeof r.data?.answer==='string'&&r.data.answer.length>100);
    r=await send('POST','/api/riwi/chat',{message:'Give one short English practice example for this grammar topic.',conversationId:created});
    check('followup_keeps_same_approved_topic',r.status===200&&r.data?.ok===true&&r.data?.conversationId===created&&
      r.data?.provenance==='approved_knowledge'&&r.data?.provider?.model===model&&
      typeof r.data?.answer==='string'&&r.data.answer.length>40);
  }catch(error){blocked=checks.some(c=>c.name===error?.message)?error.message:'browser_request_failed';}
  finally{
    if(created){
      try{const r=await send('DELETE','/api/riwi/conversations/'+created);
        const ok=r.status===200&&r.data?.ok===true&&r.data?.deleted===true&&r.data?.conversationId===created;
        checks.push({name:'delete_only_created_conversation',passed:ok});if(!ok)blocked=blocked||'cleanup_failed';
      }catch{checks.push({name:'delete_only_created_conversation',passed:false});blocked=blocked||'cleanup_failed';}
    }
    window[slot]={done:true,result:{checks,blocker:blocked,knowledgeActive:active,
      state:!blocked&&checks.every(c=>c.passed)?'teaching_library_smoke_passed':'blocked',
      semanticQuality:'limited_grounded_lesson_checks_only',parameterTrainingPerformed:false,
      liveLanguageModelValidated:false,fullAcceptance:false}};
  }
})();
return JSON.stringify({started:true});
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin",required=True,help="Immutable QA preview origin shown by Vercel")
    args=parser.parse_args()
    origin=args.origin.rstrip("/")
    if not re.fullmatch(r"https://learners-area-[a-z0-9]{6,}-learners-area\.vercel\.app",origin):
        parser.error("Use an immutable Learners Area preview origin; production/aliases are refused.")
    spec=importlib.util.spec_from_file_location("riwi_safari_smoke",ROOT/"scripts/riwi-safari-smoke.py")
    smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)
    smoke.ORIGIN=origin
    report={"kind":"original teaching library installation and conversation smoke","origin":origin,
            "time":datetime.now(timezone.utc).isoformat(),"sourceChecksum":source_checksum(),
            "state":"blocked","checks":[],"fullAcceptance":False,"parameterTrainingPerformed":False}
    slot="__riwiTeach"+uuid.uuid4().hex
    window_id=None
    try:
        if not sys.stdin.isatty():raise smoke.SmokeBlocked("run_interactively_in_terminal")
        print("Safari oldingi oynasida yangi QA preview va faol QA Owner sessiyasi bo‘lsin:")
        print(origin)
        window_id=int(smoke.applescript('tell application "/Applications/Safari.app" to get id of front window'))
        values={"__SLOT__":slot,"__ORIGIN__":origin,"__EMAIL__":smoke.EMAIL,
                "__PAYLOAD__":installation_payload(),"__CHECKSUM__":source_checksum()}
        source=FLOW_JS
        for key,value in values.items():source=source.replace(key,json.dumps(value,ensure_ascii=False))
        smoke.javascript(source,window_id)
        deadline=time.monotonic()+300
        while time.monotonic()<deadline:
            state=smoke.javascript(f"return JSON.stringify(window[{json.dumps(slot)}]||{{}});",window_id)
            if state.get("done"):report.update(state["result"]);break
            time.sleep(.3)
        else:raise smoke.SmokeBlocked("teaching_flow_timeout")
        for check in report["checks"]:print(check["name"],"PASS" if check["passed"] else "FAIL")
        print("Bilimlar faol:",report.get("knowledgeActive",False))
    except (smoke.SmokeBlocked,ValueError,OSError,KeyboardInterrupt,EOFError) as error:
        report["blocker"]=str(error) if isinstance(error,smoke.SmokeBlocked) else "local_runner_failed_or_cancelled"
        print("To‘xtadi:",report["blocker"])
    finally:
        if window_id is not None and report["state"]=="teaching_library_smoke_passed":
            try:smoke.javascript(f"delete window[{json.dumps(slot)}];return JSON.stringify({{cleaned:true}});",window_id)
            except smoke.SmokeBlocked:pass
        folder=ROOT/"qa";folder.mkdir(parents=True,exist_ok=True)
        target=folder/"riwi-safari-teach-last.json"
        with tempfile.NamedTemporaryFile(mode="w",encoding="utf-8",dir=folder,prefix=".riwi-teach-",delete=False) as h:
            temp=Path(h.name);json.dump(report,h,ensure_ascii=False,indent=2);h.write("\n")
        temp.replace(target);print("Natija:",target)
    return 0 if report["state"]=="teaching_library_smoke_passed" else 1

if __name__=="__main__":raise SystemExit(main())
