/** Slice 10: video lesson authoring. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import * as V from '../../modules/staff-final30/video-lessons.js';
import {parseTranscriptInput,parseQuestions,parseVocabulary,vocabularyHasContext} from '../../js/adapters/staff-final30/video.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
test('transcript parser: empty / timed (mm:ss and h:mm:ss) / plain paragraphs / mixed refused with line numbers',()=>{
 assert.equal(parseTranscriptInput('  \n ').kind,'empty');assert.deepEqual(parseTranscriptInput('0:05 Hello\n1:02:03 Later').lines,[{startSeconds:5,text:'Hello'},{startSeconds:3723,text:'Later'}]);
 const p=parseTranscriptInput('One\n\n\n\nTwo');assert.equal(p.kind,'plain');assert.equal(p.paragraphs,2);assert.equal(p.text,'One\n\nTwo');assert.deepEqual(parseTranscriptInput('0:01 a\nplain\n0:03 b').untimedLines,[2]);
});
test('questions + vocabulary parsers follow the source rules; vocabulary examples must occur in transcript or notes',()=>{
 assert.deepEqual(parseQuestions("Main point? || a | b\ngap_fill It is ___ || possible\nbad || \nx || y"),[{stage:'comprehension',prompt:'Main point?',acceptedAnswers:['a','b']},{stage:'gap_fill',prompt:'It is ___',acceptedAnswers:['possible']}]);
 const v=parseVocabulary('word||noun||def||uz||the word is here');assert.deepEqual(v[0],{word:'word',pos:'noun',def:'def',uz:'uz',ex:'the word is here'});
 assert.equal(vocabularyHasContext(v,{kind:'plain',text:'Say: the word is here.'},''),true);assert.equal(vocabularyHasContext(v,{kind:'empty'},'notes: the word is here'),true);assert.equal(vocabularyHasContext(v,{kind:'plain',text:'nothing'},''),false);assert.equal(vocabularyHasContext(parseVocabulary('w||n||d||u||'),{kind:'plain',text:'x'},''),false);assert.equal(vocabularyHasContext([],{kind:'empty'},''),true);
});
const data=(o={})=>envelope('video-admin',{lessons:[{id:ID(2),title:'Lesson 1'}],authored:[{id:ID(3),title:'TED talk',lessonTitle:null,provider:'youtube',transcriptSource:null,hasNotes:false,publicationState:'draft',publishAt:null},{id:ID(4),title:'Course item',lessonTitle:'Lesson 1',provider:'youtube',transcriptSource:'authored',hasNotes:true,publicationState:'published',publishAt:null}],...o});
test('list: standalone badge vs lesson title, transcript source/notes flags; publication control only for admin/owner (teacher sees none)',async()=>{
 h=setup({role:'admin',path:'/app/admin/video-lessons'});h.stub({'/api/frontend/staff/video-admin':data()});await h.mount(V);
 assert(h.q('[data-video-lesson="'+ID(3)+'"] [data-video-admin-standalone]'));assert(h.q('[data-video-lesson="'+ID(4)+'"]').textContent.includes('Lesson 1'));assert.equal(h.q('[data-video-lesson="'+ID(4)+'"] [data-video-admin-notes]').dataset.videoAdminNotes,'yes');assert.equal(h.qa('[data-publication-control]').length,2);h.dispose();
 h=setup({role:'teacher',path:'/app/admin/video-lessons'});h.stub({'/api/frontend/staff/video-admin':data()});await h.mount(V);assert.equal(h.qa('[data-publication-control]').length,0);assert(h.q('[data-video-admin-form]'));h.dispose();
 h=setup({role:'student',path:'/app/admin/video-lessons'});h.stub({});await h.mount(V);assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);h.dispose();
 h=setup({path:'/app/admin/video-lessons'});h.stub({'/api/frontend/staff/video-admin':data({authored:[]})});await h.mount(V);assert(h.ctx.root.textContent.includes(dicts.en.videoLessonAdmin.none));
});
test('form: transcript source select appears only with a transcript; exact POST body for timed transcript + description + vocabulary without exercises; success clears fields and refreshes list',async()=>{
 h=setup({path:'/app/admin/video-lessons'});let sent,authored=[];globalThis.fetch=async(p,o)=>{sent={p,b:JSON.parse(o.body)};authored=[{id:ID(9),title:'New one',lessonTitle:null,provider:'youtube',transcriptSource:'licensed',hasNotes:true,publicationState:'draft',publishAt:null}];return jres(200,{ok:true});};
 h.stub({'/api/frontend/staff/video-admin':()=>data({authored})});await h.mount(V);const f=()=>h.q('[data-video-admin-form]');
 assert.equal(f().querySelectorAll('select').length,1);h.input(h.q('[data-video-transcript-input]'),'0:05 Learning matters');assert.equal(f().querySelectorAll('select').length,2);
 h.input(h.q('[data-video-url-input]'),'https://www.youtube.com/watch?v=abc');h.input(f().querySelector('input[minlength]'),'My lesson');h.input(h.q('[data-video-notes-input]'),'notes');f().querySelectorAll('select')[0].value='licensed';f().querySelectorAll('select')[0].dispatchEvent(new window.Event('change'));
 h.input(h.q('[data-video-vocabulary-input]'),'matters||verb||counts||muhim||Learning matters');assert.equal(h.q('[data-video-questions-input]'),null);h.input(h.q('[data-video-description-input]'),'Lesson description');h.ctx.state.video.questionsText='Stale hidden exercise || answer';h.submit(f());await tick(8);
 assert.equal(sent.p,'/api/admin/video-lessons');assert.deepEqual(sent.b,{lessonId:null,title:'My lesson',videoUrl:'https://www.youtube.com/watch?v=abc',beforeYouWatch:'Lesson description',durationSeconds:null,transcriptSource:'licensed',transcriptAttribution:null,transcript:[{startSeconds:5,text:'Learning matters'}],transcriptText:null,vocabulary:[{word:'matters',pos:'verb',def:'counts',uz:'muhim',ex:'Learning matters'}],notes:'notes',questions:[]});
 assert(h.q('[data-video-admin-message=ok]'));assert.equal(h.q('[data-video-url-input]').value,'');assert(h.q('[data-video-lesson="'+ID(9)+'"]'));
});
test('form: mixed transcript and vocabulary without context are refused locally (no request); transcript text untouched',async()=>{
 h=setup({path:'/app/admin/video-lessons'});let n=0;globalThis.fetch=async()=>{n++;return jres(200,{});};h.stub({'/api/frontend/staff/video-admin':data()});await h.mount(V);const f=()=>h.q('[data-video-admin-form]');
 h.input(h.q('[data-video-url-input]'),'https://youtu.be/abc');h.input(f().querySelector('input[minlength]'),'Title');h.input(h.q('[data-video-transcript-input]'),'0:01 a\nplain line');h.submit(f());await tick(3);assert.equal(n,0);assert(h.q('[data-video-admin-message=bad]').textContent.includes(dicts.en.videoLessonAdmin.transcriptMixed));
 h.input(h.q('[data-video-transcript-input]'),'just text');h.input(h.q('[data-video-vocabulary-input]'),'w||n||d||u||absent example');h.submit(f());await tick(3);assert.equal(n,0);assert(h.q('[data-video-admin-message=bad]').textContent.includes(dicts.en.videoLessonAdmin.vocabularyContextRequired));assert.equal(h.q('[data-video-transcript-input]').value,'just text');
});
test('form: server refusal reason (unsupported host) and error codes are localized; vocabulary_context_required override; network failure generic; double submit once',async()=>{
 h=setup({path:'/app/admin/video-lessons'});let mode='reason',n=0;globalThis.fetch=async()=>{n++;await tick(2);if(mode==='net')throw new Error('x');return mode==='reason'?jres(400,{error:'invalid_video',reason:Object.keys(dicts.en.videoLessonAdmin.rejection)[0]}):mode==='vocab'?jres(400,{error:'vocabulary_context_required'}):jres(403,{error:'forbidden'});};
 h.stub({'/api/frontend/staff/video-admin':data()});await h.mount(V);const f=()=>h.q('[data-video-admin-form]'),fill=()=>{h.input(h.q('[data-video-url-input]'),'https://x.example.invalid/v');h.input(f().querySelector('input[minlength]'),'Title');};fill();
 h.submit(f());h.submit(f());await tick(8);assert.equal(n,1);assert(h.q('[data-video-admin-message=bad]').textContent.includes(Object.values(dicts.en.videoLessonAdmin.rejection)[0]));assert.equal(h.q('[data-video-url-input]').value,'https://x.example.invalid/v');
 mode='vocab';h.submit(f());await tick(8);assert(h.q('[data-video-admin-message=bad]').textContent.includes(dicts.en.videoLessonAdmin.vocabularyContextRequired));mode='403';h.submit(f());await tick(8);assert(h.q('[data-video-admin-message=bad]').textContent.includes(dicts.en.apiErrors.forbidden));mode='net';h.submit(f());await tick(8);assert(h.q('[data-video-admin-message=bad]').textContent.includes(dicts.en.errors.unknown));
});
