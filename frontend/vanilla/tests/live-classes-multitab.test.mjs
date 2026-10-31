import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {newAttendanceSessionId} from '../modules/live-classes/contract.js';

test('browser room identifiers are UUID shaped and unique per room mount',()=>{
 const ids=Array.from({length:100},()=>newAttendanceSessionId());
 assert.equal(new Set(ids).size,100);
 assert.ok(ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)));
});

test('join, heartbeat and leave carry the same room-scoped sessionId',()=>{
 // This wiring test complements the backend's executable multi-tab tests.
 const path=fileURLToPath(new URL('../modules/live-classes/room.js',import.meta.url));
 const source=readFileSync(path,'utf8');
 assert.match(source,/roomJoinState=\{sessionId:newAttendanceSessionId\(\)/);
 assert.match(source,/body:\{sessionId:roomJoinState\.sessionId\}/);
 assert.match(source,/body:\{action,sessionId:roomJoinState\.sessionId\}/);
});
