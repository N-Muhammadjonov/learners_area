import {test} from 'node:test';
import assert from 'node:assert/strict';
import {joinState,opensAt,parseLiveClasses,safeExternalUrl,safeObjectKey} from '../modules/live-classes/contract.js';
import {parseNotifications,internalHref} from '../modules/notifications/page.js';
const ID='11111111-1111-4111-8111-111111111111';
const lesson={id:ID,title:'IELTS',topic:null,teacherUserId:null,scheduledAt:'2026-10-25T10:00:00Z',durationMinutes:60,status:'upcoming',meetingUrl:null,recordingUrl:null};
test('V61: source join window is precisely -15min/+30min',()=>{
 assert.equal(opensAt(lesson).toISOString(),'2026-10-25T09:45:00.000Z');
 assert.equal(joinState(lesson,new Date('2026-10-25T09:44:59.999Z')),'too_early');
 assert.equal(joinState(lesson,new Date('2026-10-25T09:45:00Z')),'open');
 assert.equal(joinState(lesson,new Date('2026-10-25T11:30:00Z')),'open');
 assert.equal(joinState(lesson,new Date('2026-10-25T11:30:00.001Z')),'closed');
});
test('V61: cancelled first, live forced open',()=>{
 assert.equal(joinState({...lesson,status:'cancelled'},new Date('2026-10-25T10:00:00Z')),'cancelled');
 assert.equal(joinState({...lesson,status:'live'},new Date('2026-10-20T10:00:00Z')),'open');
});
test('V61: core projection must be well-formed and never made up by UI',()=>{
 const payload={courseAvailable:true,upcoming:[lesson],past:[],attendance:[],teachers:[],materials:{}};
 assert.equal(parseLiveClasses(payload).upcoming.length,1);
 assert.throws(()=>parseLiveClasses({...payload,attendanceUnavailable:true}));
 assert.throws(()=>parseLiveClasses({...payload,upcoming:[lesson,lesson]}));
 assert.throws(()=>parseLiveClasses({...payload,upcoming:[{...lesson,id:'bad'}]}));
});
test('V61: secondary failure must not hide a valid learner class',()=>{
 const d=parseLiveClasses({courseAvailable:true,upcoming:[lesson],past:[],attendance:[],metadataUnavailable:true});
 assert.equal(d.upcoming.length,1);assert.equal(d.metadataUnavailable,true);
});
test('V61: only HTTPS/HTTP meeting links and private object keys',()=>{
 assert.equal(safeExternalUrl('javascript:alert(1)'),null);
 assert.equal(safeExternalUrl('https://user:pass@example.com'),null);
 assert.equal(safeExternalUrl('https://meet.example/room'),'https://meet.example/room');
 assert.equal(safeObjectKey('../../secrets'),null);
 assert.equal(safeObjectKey('classes/a/file.mp3'),'classes/a/file.mp3');
});
test('V62: read-only GET row shape validation',()=>{
 const row={id:ID,title:'Accepted',createdAt:'2026-10-24T10:00:00Z',readAt:null};
 assert.equal(parseNotifications({ok:true,unread:1,notifications:[row]}).rows.length,1);
 assert.throws(()=>parseNotifications({ok:true,unread:-1,notifications:[]}));
 assert.throws(()=>parseNotifications({ok:false,unread:0,notifications:[]}));
 assert.throws(()=>parseNotifications({ok:true,unread:2,notifications:[row,row]}));
});
test('V62: notification links cannot navigate off site',()=>{
 assert.equal(internalHref('/app/coach?filter=weak'),'/app/coach?filter=weak');
 for(const x of ['javascript:bad()','https://elsewhere.test','//evil.test','/\\evil.test'])assert.equal(internalHref(x),null);
});
