"""Exercise the Safari workflow in an isolated Node VM; no browser or network."""
import ast
import json
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[3]

HARNESS=r'''
const vm=require('node:vm'),fs=require('node:fs');
const flow=JSON.parse(fs.readFileSync(0,'utf8'));
const sourceId='11111111-1111-4111-8111-111111111111',convId='22222222-2222-4222-8222-222222222222';
const origin='https://learners-area-abcdefghi-learners-area.vercel.app',email='qa-owner@learnersarea.test',checksum='a'.repeat(64);
async function run(mode){
 const calls=[],window={};let state=mode==='existing'?'active':'candidate';
 const payload={title:'RIWI Original Learning Library v1',content:'synthetic fixture'};
 async function fetch(path,opts){
  const method=opts.method;calls.push({path,method});
  if(opts.credentials!=='same-origin'||opts.redirect!=='error')throw Error('unsafe options');
  let data={ok:true},status=200;
  if(path==='/api/frontend/session')data={session:{user:{role:mode==='wrong_owner'?'teacher':'owner',accountStatus:'active',email}}};
  else if(path==='/api/riwi/owner/diagnostics')data={rollout:{externalAi:mode==='external_on',knowledgeIngestion:true},providers:mode==='old_code'?[]:[{id:'vercel'}]};
  else if(path==='/api/riwi/owner/knowledge'&&method==='GET')data={ok:true,items:['existing','wrong_checksum'].includes(mode)?[{title:payload.title,id:sourceId}]:[]};
  else if(path==='/api/riwi/owner/knowledge'&&method==='POST')data={ok:true,source:{id:sourceId,checksum,unitCount:92,conflictCount:mode==='conflict'?1:0}};
  else if(path==='/api/riwi/owner/knowledge/'+sourceId)data={ok:true,source:{checksum:mode==='wrong_checksum'?'wrong':checksum,unit_count:92,state}};
  else if(path.endsWith('/approve')){state='approved';data={ok:true,source:{state}};}
  else if(path.endsWith('/promote')){state='active';data={ok:true,source:{state}};}
  else if(path==='/api/riwi/chat'){
   const body=JSON.parse(opts.body);
   data={ok:true,conversationId:convId,answer:'A meaningful original grammar example. '.repeat(8),
    provenance:mode==='bad_answer'?'unavailable':'approved_knowledge',
    provider:{id:'riwi',model:'riwi-curriculum-v1:grammar.past-simple-vs-present-perfect'},
    citations:[{sourceId}]};
   if(body.conversationId&&body.conversationId!==convId)throw Error('wrong conversation');
  }else if(path==='/api/riwi/conversations/'+convId&&method==='DELETE')data={ok:true,deleted:true,conversationId:convId};
  else throw Error('unexpected path');
  return {status,json:async()=>data};
 }
 let js=flow;
 for(const [token,value] of Object.entries({__SLOT__:'slot',__ORIGIN__:origin,__EMAIL__:email,__PAYLOAD__:payload,__CHECKSUM__:checksum}))
  js=js.replaceAll(token,JSON.stringify(value));
 const ctx=vm.createContext({window,location:{origin:mode==='wrong_origin'?'https://wrong.test':origin},fetch,AbortController,setTimeout,clearTimeout});
 vm.runInContext('(function(){'+js+'})()',ctx);
 for(let i=0;i<100&&!window.slot?.done;i++)await new Promise(setImmediate);
 if(!window.slot?.done)throw Error('workflow did not finish');
 const r=window.slot.result,post=calls.filter(c=>c.method==='POST'),deleted=calls.filter(c=>c.method==='DELETE');
 if(['success','existing'].includes(mode)){
  if(r.state!=='teaching_library_smoke_passed'||!r.knowledgeActive||r.fullAcceptance!==false||r.parameterTrainingPerformed!==false)throw Error(mode+' false readiness');
  if(deleted.length!==1)throw Error('missing cleanup');
  if(mode==='existing'&&post.some(c=>c.path.includes('/owner/knowledge')))throw Error('not idempotent');
 }else{
  if(r.state!=='blocked')throw Error(mode+' not blocked');
  if(['wrong_owner','external_on','old_code','wrong_origin','wrong_checksum'].includes(mode)&&post.length)throw Error(mode+' mutated data');
  if(mode==='conflict'&&post.length!==1)throw Error('conflict automatically resolved');
  if(mode==='bad_answer'&&deleted.length!==1)throw Error('failed answer not cleaned');
 }
 return {mode,state:r.state,passed:true};
}
(async()=>{const out=[];for(const m of ['success','existing','wrong_owner','external_on','old_code','wrong_origin','wrong_checksum','conflict','bad_answer'])out.push(await run(m));console.log(JSON.stringify(out));})().catch(e=>{console.error(e.message);process.exitCode=1});
'''

class SafariTeachTest(unittest.TestCase):
    def test_guarded_owner_installation_and_failure_cleanup(self):
        if not shutil.which("node"):self.skipTest("Node is required for the isolated workflow VM")
        tree=ast.parse((ROOT/"scripts/riwi-safari-teach.py").read_text())
        flow=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and
                  any(isinstance(t,ast.Name) and t.id=="FLOW_JS" for t in n.targets))
        proc=subprocess.run(["node","-e",HARNESS],input=json.dumps(flow),text=True,capture_output=True,timeout=15)
        self.assertEqual(proc.returncode,0,proc.stderr)
        cases=json.loads(proc.stdout)
        self.assertEqual(len(cases),9)
        self.assertTrue(all(case["passed"] for case in cases))

if __name__=="__main__":unittest.main()
