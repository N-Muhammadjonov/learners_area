import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {fixtureSession} from './fixtures.mjs';
import {createShell} from '../modules/shell/layout.js';
import {moduleLayout} from '../modules/shell/module-layout.js';
import {sectionIdentity} from '../modules/shell/section-header.js';
import {managementAreas,mount as management} from '../modules/staff-final30/management-hub.js';
import {canonicalPath} from '../js/navigation.js';
import {SidebarNav} from '../js/generated/sidebar.js';

function shellFixture(path){
 const h=setup({path,role:'owner'});
 for(const key of ['MutationObserver','Element','localStorage','sessionStorage','CustomEvent'])globalThis[key]=h.dom.window[key];
 h.dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 h.ctx.session=fixtureSession('owner').session;h.stub({'/api/notifications':{unread:0}});
 const shell=createShell(h.ctx);h.ctx.root.append(shell.host);return {h,shell};
}
test('ordinary modules and Management use the Dock without a Main control, sidebar or hamburger',async()=>{
 const {h,shell}=shellFixture('/app/management');
 try{
  assert.equal(h.q('[data-shell-sidebar]'),null);assert.equal(h.q('[data-mobile-nav-toggle]'),null);
  assert.equal(h.q('[data-campus-main-link]'),null);assert.equal(h.q('[data-module-dock]').hidden,false);
  const top=h.q('[data-shell-topbar]');
  for(const selector of ['[data-campus-header-search]','[data-campus-header-preferences]','[data-campus-header-profile]'])assert.equal(top.querySelector(selector).parentElement,top);
  assert(top.querySelector('[data-campus-header-identity] [data-campus-back-link]'));
  shell.update(new URL('/app','https://fixture.invalid'));assert.equal(h.q('[data-campus-back-link]').hidden,true);
  shell.update(new URL('/app/reading/lessons','https://fixture.invalid'));assert.equal(h.q('[data-campus-back-link]').hidden,true);
  assert.equal(h.q('[data-module-section-heading]').textContent,h.ctx.dict.readingV4.products.lessons.title);
  assert.equal(h.q('[data-campus-module-name]').nextElementSibling.firstElementChild,h.q('[data-module-section-heading]'));
 }finally{h.dispose();}
});
test('module tabs move into the pinned section band without cloning their handlers or duplicating titles',async()=>{
 const {h,shell}=shellFixture('/app/listening/lessons');
 try{
  const body=document.createElement('section');body.textContent='Fixture lessons';
  shell.outlet.append(moduleLayout(h.ctx,[body]));shell.attachModuleHeader(shell.outlet);await tick();
  assert.equal(shell.outlet.querySelector('[data-module-sections]'),null);
  assert.equal(h.q('[data-native-module-header] [data-module-sections]').dataset.moduleSections,'listening');
  assert.equal(h.q('[data-native-module-header] [data-module-section-heading]'),null);
  assert(h.q('a[href="/app/listening/tests"]'));
  assert.equal(sectionIdentity(new URL('/app/listening/tests','https://fixture.invalid'),h.ctx.dict).key,'tests');
 }finally{h.dispose();}
});
test('Management cards preserve every role-authorized sidebar destination while its redundant heading and return button are absent',async()=>{
 for(const role of ['teacher','admin','owner']){
  const h=setup({path:'/app/management',role});
  try{
   await management(h.ctx);assert.equal(h.q('h1'),null);assert.equal(h.q('[data-management-back]'),null);
   const cards=new Set(managementAreas(h.ctx.dict,role).map(item=>item.href));
   const old=SidebarNav({dict:h.ctx.dict,role,email:'fixture@example.invalid',pathname:'/app/management'});
   for(const a of old.querySelectorAll('[data-sidebar-link]')){
    const raw=a.getAttribute('href'),href=canonicalPath(new URL(raw,'https://fixture.invalid'))||raw;if(!['/app','/app/management'].includes(href))assert(cards.has(href),role+' lost '+href);
   }
  }finally{h.dispose();}
 }
});
