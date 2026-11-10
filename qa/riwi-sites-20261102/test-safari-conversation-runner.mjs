import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const python=new URL('../../scripts/riwi-safari-conversation-smoke.py',import.meta.url);
const source=execFileSync('python3',['-c',
  "import ast,sys; m=ast.parse(open(sys.argv[1]).read()); print(next(ast.literal_eval(n.value) for n in m.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FLOW_JS' for t in n.targets)))",
  python.pathname],{encoding:'utf8'});
const origin='https://learners-area-kmmgxbz7p-learners-area.vercel.app';
const email='qa-owner@learnersarea.test',slot='__testQaResult';
const created='11111111-1111-4111-8111-111111111111';
const foreign='22222222-2222-4222-8222-222222222222';
const body=source.replaceAll('__SLOT__',JSON.stringify(slot)).replaceAll('__ORIGIN__',JSON.stringify(origin)).replaceAll('__EMAIL__',JSON.stringify(email));

async function run(options={}){
  const window={},requests=[],messages=[];
  let turns=0,deleted=false;
  const context={window,location:{origin:options.wrongOrigin?'https://unrelated.invalid':origin},AbortController,setTimeout,clearTimeout,
    fetch:async(path,request)=>{
      const {method}=request;
      const payload=request.body?JSON.parse(request.body):null;
      requests.push({path,method,payload});
      assert.equal(request.credentials,'same-origin');
      assert.equal(request.redirect,'error');
      assert.equal(request.cache,'no-store');
      let status=200,data;
      if(path==='/api/frontend/session')data={session:{user:{role:options.wrongActor?'student':'owner',accountStatus:'active',email}}};
      else if(path==='/api/riwi/owner/diagnostics')data={rollout:{externalAi:options.external===true}};
      else if(path==='/api/riwi/chat'&&method==='POST'){
        turns++;
        assert.deepEqual(Object.keys(payload).sort(),turns===1?['message']:['conversationId','message']);
        if(turns>1)assert.equal(payload.conversationId,created);
        if(options.postFailure&&turns===1){status=503;data={ok:false,error:'service_unavailable'};}
        else{
          const answer='Synthetic answer '+turns;
          messages.push({role:'user',content:payload.message},{role:'assistant',content:answer});
          data={ok:true,conversationId:options.foreignReply&&turns===2?foreign:created,
            provider:{id:options.unexpectedProvider?'openai':'riwi'},
            provenance:turns===3?(options.guardFailure?'unavailable':'policy_refusal'):(options.unavailable?'unavailable':'canonical_grammar'),
            answer:options.emptyAnswer?'':answer};
        }
      }else if(path==='/api/riwi/conversations/'+created){
        if(method==='DELETE'){
          if(options.cleanupFailure){status=503;data={ok:false};}
          else{deleted=true;data={ok:true,deleted:true,conversationId:created};}
        }else if(deleted){status=404;data={ok:false,error:'not_found'};}
        else data={ok:true,conversationId:created,messages:messages.map((m,i)=>({...m,
          content:options.tamperedTranscript&&i===1?'Different stored answer':m.content}))};
      }else throw new Error('unexpected_fixture_path');
      return {status,json:async()=>data};
    }};
  vm.runInNewContext('(function(){'+body+'})()',context);
  for(let i=0;i<100&&!window[slot]?.done;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(window[slot]?.done,true,'runner did not finish');
  const result=JSON.parse(JSON.stringify(window[slot].result));
  const serialized=JSON.stringify(result);
  assert(!serialized.includes('Synthetic answer'));
  assert(!serialized.includes(created));
  assert(!serialized.includes(foreign));
  assert(!serialized.includes(email));
  assert.equal(result.fullAcceptance,false);
  assert.equal(result.semanticQuality,'not_validated');
  assert(requests.filter(r=>r.method==='DELETE').every(r=>r.path.endsWith(created)));
  return {result,requests};
}

test('three turns persist exactly, guard refuses and only the created conversation is removed',async()=>{
  const {result,requests}=await run();
  assert.equal(result.state,'conversation_transport_passed');
  assert.equal(result.checks.length,10);
  assert(result.checks.every(c=>c.passed));
  assert.equal(result.cleanup,'passed');
  assert.equal(result.normalAnswerAvailable,true);
  assert.equal(requests.filter(r=>r.method==='POST').length,3);
});
test('unavailable content never becomes a semantic acceptance claim',async()=>{
  const {result}=await run({unavailable:true});
  assert.equal(result.state,'conversation_transport_passed');
  assert.equal(result.normalAnswerAvailable,false);
  assert.equal(result.normalAnswerProvenance,'unavailable');
});
for(const [name,options,posts] of [
  ['wrong origin',{wrongOrigin:true},0],
  ['wrong actor',{wrongActor:true},0],
  ['external provider enabled',{external:true},0],
  ['POST failure',{postFailure:true},1],
  ['empty answer',{emptyAnswer:true},1],
  ['unexpected provider',{unexpectedProvider:true},1],
  ['changed persisted answer',{tamperedTranscript:true},1],
  ['foreign conversation ID in follow-up',{foreignReply:true},2],
  ['refusal guard failure',{guardFailure:true},3],
  ['cleanup failure',{cleanupFailure:true},3],
])test(name+' blocks acceptance without a POST retry',async()=>{
  const {result,requests}=await run(options);
  assert.equal(result.state,'blocked');
  assert.equal(requests.filter(r=>r.method==='POST').length,posts);
  if(options.external||options.wrongActor||options.wrongOrigin||options.postFailure)
    assert.equal(requests.filter(r=>r.method==='DELETE').length,0);
  if(options.cleanupFailure)assert.equal(result.cleanup,'failed');
});
