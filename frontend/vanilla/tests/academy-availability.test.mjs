import assert from 'node:assert/strict';
import {test} from 'node:test';
import routes from '../js/routes.js';
import {createWorkspace} from '../js/workspace.js';
import {learnerJourney} from '../modules/shared/learner-journey.js';
import {studentAttendance} from '../modules/staff-final30/academy-attendance.js';
import {financeInProfile} from '../modules/staff-final30/academy-finance.js';
import {studentGroupHistory} from '../modules/staff-final30/academy-groups.js';
import {mount as management} from '../modules/staff-final30/management-hub.js';
import {ID,setup} from './staff-final30/harness.mjs';

test('baseline session hides Academy deep links and panels while preserving Management', async () => {
 const h=setup({path:'/app/management/finance',role:'owner'});
 const owner={...h.ctx.session.user,role:'owner'};
 const session={user:owner,academyEnabled:false,expiresAt:Math.floor(Date.now()/1000)+90,accessEventsEnabled:false};
 h.stub({'/api/frontend/session':{version:1,session}});
 const workspace=createWorkspace(h.ctx.root);
 try{
  const academyRoutes=routes.filter(route=>route.requiresAcademy);
  assert.equal(academyRoutes.length,6);
  await workspace.prepare({...h.ctx,route:academyRoutes[0]});
  for(const route of academyRoutes){
   const url=new URL(route.pattern,h.ctx.url);
   assert.deepEqual(await workspace.prepare({...h.ctx,route,url}),{redirect:'/app/management'});
  }
  const hubRoute=routes.find(route=>route.pattern==='/app/management');
  const prepared=await workspace.prepare({...h.ctx,route:hubRoute,url:new URL(hubRoute.pattern,h.ctx.url)});
  assert.equal(prepared.redirect,undefined);
  await management({...h.ctx,...prepared});
  for(const route of academyRoutes)assert.equal(h.q(`[data-management-area="${route.pattern}"]`),null);
  assert(h.q('[data-management-area="/app/management/study-plans"]'));
  assert(h.q('[data-management-area="/app/management/guardians"]'));
  const disabled={...h.ctx,...prepared};
  assert.equal(studentAttendance(disabled,'/unused'),null);
  assert.equal(learnerJourney(disabled,'/unused'),null);
  assert.equal(studentGroupHistory(disabled,ID(1)),null);
  assert.equal(financeInProfile(disabled,ID(1)),null);
  assert.deepEqual(h.calls.map(call=>call.path),['/api/frontend/session']);
 }finally{workspace.destroy();h.dispose();}
});
