import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import routes from '../js/routes.js';
import {compilePattern} from '../js/router.js';
import {workspaceKey} from '../js/generated/interaction-navigation.js';
import {breadcrumbsFor,parentFor} from '../js/generated/nav-routes.js';
import en from '../js/i18n/en.js';

const live='/app/live-classes';
const room='/app/live-classes/11111111-1111-4111-8111-111111111101';
const route=pattern=>routes.find(item=>item.pattern===pattern);

test('Live Classes uses the main SPA router for catalogue and class rooms',async()=>{
 const catalogue=route(live),detail=route(live+'/:id');
 assert.ok(catalogue && detail,'both routes registered');
 assert.equal(catalogue.protected,true);
 assert.equal(detail.protected,true);
 assert.ok(String(catalogue.load).includes('live-classes/page.js'));
 assert.ok(String(detail.load).includes('live-classes/room.js'));
 assert.ok(compilePattern(detail.pattern).test(room));
 assert.equal(workspaceKey(room),'live-classes');
 assert.equal(workspaceKey(live),'live-classes');
});

test('progressive navigation remains for passive catalogue; active Live room is transactional',()=>{
 assert.equal(route(live)?.progressiveMount,true);
 assert.notEqual(route(live+'/:id')?.progressiveMount,true);
 assert.equal(route('/app/progress')?.progressiveMount,true,'unrelated main navigation preserved');
 assert.equal(route('/app/listening/tests')?.progressiveMount,true,'existing catalogue remains optimized');
 const reuse=readFileSync(fileURLToPath(new URL('../js/route-reuse.js',import.meta.url)),'utf8');
 assert.match(reuse,/const PASSIVE=/);
 assert.equal(reuse.includes("'/app/live-classes'"),false,'Live Classes is not retained by passive cache');
});

test('Live Classes breadcrumb/back chain stays inside SPA',()=>{
 const hub=breadcrumbsFor(live,en);
 assert.equal(hub.at(-1)?.href,live);
 const crumbs=breadcrumbsFor(room,en);
 assert.ok(crumbs.length>=2);
 assert.equal(crumbs[0].href,live);
 assert.equal(parentFor(room,en)?.href,live);
});
