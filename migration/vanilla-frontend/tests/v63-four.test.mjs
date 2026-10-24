import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {testsHref,catalogueModel} from '../modules/listening/tests-catalogue.js';
import {mount as listeningLanding} from '../modules/listening/landing.js';
const id='11111111-1111-4111-8111-111111111111';
const card={testId:id,title:'Published test',parts:4,questions:40,minutes:null,completed:0,activityCount:5,started:false,locked:false,exam:null};
test('V63 Listening Tests preserves canonical tests/:id destination',()=>{
 assert.equal(testsHref(id),'/app/listening/tests/'+id);
 assert.throws(()=>testsHref('not-a-uuid'));
});
test('V63 tests catalogue adapter rejects invented totals and leaked payloads',()=>{
 assert.equal(catalogueModel({cards:[card],total:1}).cards[0].title,'Published test');
 assert.throws(()=>catalogueModel({cards:[card],total:2}));
 assert.throws(()=>catalogueModel({cards:[{...card,answers:'secret'}],total:1}));
});
test('V63 Listening module root is a replace redirect, not a second dashboard',()=>{
 let call;listeningLanding({signal:new AbortController().signal,navigate:(...args)=>call=args});
 assert.deepEqual(call,['/app/listening/lessons',{replace:true}]);
 const dead=new AbortController();dead.abort();call=null;listeningLanding({signal:dead.signal,navigate:(...args)=>call=args});assert.equal(call,null);
});
test('V63 shared LessonAuthoringDesk has source-specific areas and safe role gating',()=>{
 const root=path.dirname(fileURLToPath(import.meta.url));
 const source=fs.readFileSync(path.join(root,'../modules/listening/lesson-authoring.js'),'utf8');
 assert.match(source,/const authorArea=/);
 assert.match(source,/form=blankForm\(authorArea,/);
 assert.match(source,/\['teacher','admin','owner'\]\.includes\(session\?\.user\?\.role\)/);
 assert.match(source,/const lessonListHref=/);
 assert.match(source,/data-lesson-authoring-area/);
});
