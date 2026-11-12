import {test} from 'node:test';
import assert from 'node:assert/strict';
import routes from '../js/routes.js';
import {returnPolicy} from '../modules/campus/return-policy.js';
import {
  grammarPracticeHref,isValidPracticeBook,isValidPracticeTrack,
} from '../modules/grammar/practice-route.js';

const url=value=>new URL(value,'https://fixture.invalid');

test('Grammar book keeps Back navigation without focus mode',()=>{
  const route=routes.find(item=>item.pattern==='/app/grammar/practice');
  assert(route);
  assert.equal(route.protected,true);
  assert.notEqual(route.layout,'focus');
  assert.deepEqual(returnPolicy(url('/app/grammar/practice?book=b2-65&from=plan')),
    {mode:'back',href:'/app/assignments#study-plan-30'});
  assert.deepEqual(returnPolicy(url('/app/grammar/practice?book=a0-1')),
    {mode:'back',href:'/app/grammar/lessons'});
  assert.deepEqual(returnPolicy(url('/app/grammar/practice?book=spk-01&track=speaking')),
    {mode:'back',href:'/app/grammar?tab=speaking'});
  assert.deepEqual(returnPolicy(url('/app/grammar/practice?book=wrt-01&track=writing')),
    {mode:'back',href:'/app/grammar?tab=writing'});
});

test('catalogue and study-plan book routes reuse existing immutable lesson identifiers',()=>{
  assert.equal(grammarPracticeHref('/app/grammar/lessons?book=a0-1'),
    '/app/grammar/practice?book=a0-1');
  assert.equal(grammarPracticeHref('/app/grammar/lessons?book=a0-1',{fromPlan:true}),
    '/app/grammar/practice?book=a0-1&from=plan');
  assert.equal(grammarPracticeHref('/app/grammar?tab=speaking&book=spk-01',{fromPlan:true}),
    '/app/grammar/practice?book=spk-01&track=speaking&from=plan');
  assert.equal(grammarPracticeHref('/app/grammar?tab=writing&book=wrt-01'),
    '/app/grammar/practice?book=wrt-01&track=writing');
});

test('non-book routes and untrusted identifiers never turn into focus lesson links',()=>{
  assert.equal(grammarPracticeHref('/app/grammar'),'/app/grammar');
  assert.equal(grammarPracticeHref('/app/grammar?tab=speaking'),
    '/app/grammar?tab=speaking');
  assert.equal(grammarPracticeHref('/app/grammar/lessons?book=../../unsafe'),
    '/app/grammar/lessons?book=../../unsafe');
  assert.equal(grammarPracticeHref('https://outside.example/attack'),
    'https://outside.example/attack');
  assert(!isValidPracticeBook('../admin'));
  assert(!isValidPracticeTrack('invalid'));
  assert(isValidPracticeBook('a0-1'));
  assert(isValidPracticeTrack('writing'));
});
