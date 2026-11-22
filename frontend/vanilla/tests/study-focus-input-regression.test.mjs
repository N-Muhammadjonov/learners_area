import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './staff-final30/harness.mjs';
import {studyFocus,supportsStudyFocus,isGrammarExercise} from '../modules/shell/study-focus.js';
import {profileMenu} from '../modules/shell/profile.js';

const makeUrl=path=>new URL(path,'https://fixture.invalid');
const pressF=(window,target)=>{
 const event=new window.KeyboardEvent('keydown',{key:'f',bubbles:true,composed:true,cancelable:true});
 target.dispatchEvent(event);
 return event;
};

test('Grammar details with Back and no Dock never enable Focus mode',()=>{
 const h=setup({path:'/app/grammar/practice?book=a0-1',role:'student'});
 try{
  assert.equal(isGrammarExercise(h.ctx.url),true);
  assert.equal(supportsStudyFocus(h.ctx.url),false);
  assert.equal(supportsStudyFocus(makeUrl('/app/grammar/practice?book=a0-1&track=writing')),false);
  assert.equal(supportsStudyFocus(makeUrl('/app/grammar/lessons')),true);
  const focus=studyFocus(h.ctx);
  focus.update(h.ctx.url);
  assert.equal(focus.useful,false);
  assert.equal(focus.on,false);
  focus.toggle();
  pressF(h.dom.window,document.body);
  assert.equal(document.documentElement.dataset.studyFocus,'off');
  assert.equal(document.documentElement.dataset.focus,'off');
 }finally{h.dispose();}
});

test('typing F in standard, rich-text and ShadowRoot editors never toggles Focus mode',()=>{
 const h=setup({path:'/app/writing',role:'student'});
 try{
  const focus=studyFocus(h.ctx);
  focus.update(h.ctx.url);
  assert.equal(focus.useful,true);
  const root=h.ctx.root;
  const button=document.createElement('button');
  button.textContent='Regular action';
  root.append(button);
  const first=pressF(h.dom.window,button);
  assert.equal(first.defaultPrevented,true);
  assert.equal(focus.on,true);

  const field=document.createElement('input');
  root.append(field);field.focus();
  assert.equal(pressF(h.dom.window,field).defaultPrevented,false);
  assert.equal(focus.on,true);
  const textarea=document.createElement('textarea');
  root.append(textarea);textarea.focus();
  assert.equal(pressF(h.dom.window,textarea).defaultPrevented,false);
  assert.equal(focus.on,true);

  const editor=document.createElement('div');
  editor.setAttribute('contenteditable','true');
  editor.setAttribute('tabindex','0');
  const child=document.createElement('span');
  editor.append(child);root.append(editor);editor.focus();
  assert.equal(pressF(h.dom.window,child).defaultPrevented,false);
  assert.equal(focus.on,true);

  const textbox=document.createElement('div');
  textbox.setAttribute('role','textbox');
  textbox.setAttribute('tabindex','0');
  root.append(textbox);textbox.focus();
  assert.equal(pressF(h.dom.window,textbox).defaultPrevented,false);
  assert.equal(focus.on,true);

  const host=document.createElement('div');
  const shadow=host.attachShadow({mode:'open'});
  const nested=document.createElement('input');
  shadow.append(nested);root.append(host);nested.focus();
  assert.equal(document.activeElement,host,'ShadowRoot retargets activeElement to the host');
  assert.equal(pressF(h.dom.window,nested).defaultPrevented,false);
  assert.equal(focus.on,true);

  button.focus();
  const last=pressF(h.dom.window,button);
  assert.equal(last.defaultPrevented,true);
  assert.equal(focus.on,false);
 }finally{h.dispose();}
});

test('topbar and menu display names stay black after profile updates',()=>{
 const h=setup({path:'/app/profile',role:'student'});
 try{
  const profile=profileMenu(h.ctx);
  h.ctx.root.append(profile.node);
  const trigger=profile.node.querySelector('[data-profile-menu-trigger]');
  const name=profile.node.querySelector('[data-profile-name]');
  assert.equal(name.style.color,'rgb(0, 0, 0)');
  trigger.click();
  const menu=profile.node.querySelector('[data-profile-menu]');
  assert(menu);
  assert.equal(menu.firstElementChild.querySelector('p').style.color,'rgb(0, 0, 0)');
  profile.update({...h.ctx.session.user,name:'Renamed Learner'});
  assert.equal(name.textContent,'Renamed Learner');
  assert.equal(name.style.color,'rgb(0, 0, 0)');
  assert.equal(menu.firstElementChild.querySelector('p').textContent,'Renamed Learner');
  assert.equal(menu.firstElementChild.querySelector('p').style.color,'rgb(0, 0, 0)');
 }finally{h.dispose();}
});
