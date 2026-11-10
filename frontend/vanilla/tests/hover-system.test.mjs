import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {JSDOM} from 'jsdom';

const css=readFileSync(new URL('../modules/shared/design-system.css',import.meta.url),'utf8');
const ast=postcss.parse(css),rules=[];
ast.walkRules(rule=>rules.push(rule));
const has=(rule,prop,value)=>rule.nodes.some(d=>d.prop===prop&&d.value.includes(value));
const cardHover=rules.find(r=>has(r,'transform','var(--la-hover-card-lift)'));
const emulate=selector=>selector.replaceAll(':hover','[data-qa-hover]').replaceAll(':active','[data-qa-active]').replaceAll(':focus-visible','[data-qa-focus]');
function fixture(){
 return new JSDOM(`<html data-theme="day"><body><div id="root"><main data-ui-system>
 <div id="grid">${Array.from({length:12},(_,i)=>`<a id="c${i}" href="#${i}" class="card">Card ${i}</a>`).join('')}</div>
 <a id="video" href="#video" data-video-lesson-open>TED</a>
 <article id="catalogue" data-academic-set data-academic-locked="false"><a href="#test">Open</a></article>
 <article id="locked" data-academic-set data-academic-locked="true">Locked</article>
 <button id="disabled" class="card" disabled>Disabled</button>
 <a id="unavailable" class="card" href="#disabled" aria-disabled="true">Unavailable</a>
 <button id="busy" class="card" aria-busy="true">Loading</button>
 <div id="stats" class="card" data-ui-card="statistics"><button>Retry</button></div>
 <article id="answer" class="card" data-question><input class="input"></article>
 <section id="recorder" class="card" data-question-recorder><button class="btn-primary">Record</button></section>
 <div id="dock" class="module-dock"><a href="#dock" data-dock-module>Dock</a></div>
 <input id="input" class="input"><select id="select" class="input"><option>All</option></select><textarea id="textarea" class="input"></textarea>
 <button id="primary" class="btn-primary">Save</button><button id="secondary" class="btn-secondary" aria-selected="true">Selected</button>
 <button id="tab" class="tab" role="tab" aria-selected="true">All</button>
 </main><div id="exam"><a class="card" href="#exam">Focus frame</a></div></div></body></html>`).window.document;
}

test('hover selectors parse and decorative pseudo elements stay outside :is()',()=>{
 for(const rule of rules)selectorParser(root=>root.walkPseudos(p=>{
  if([':is',':where',':not',':has'].includes(p.value))p.walkPseudos(child=>assert(!child.value.startsWith('::'),rule.selector));
 })).processSync(rule.selector);
 assert(!/transition\s*:\s*all\b/.test(css));
});

test('navigation contracts include native cards and exclude editors, stats, locked tests, Dock and focus frames',()=>{
 const doc=fixture();for(const e of doc.querySelectorAll('*'))e.setAttribute('data-qa-hover','');
 const selected=[...doc.querySelectorAll(emulate(cardHover.selector))].map(e=>e.id);
 assert.deepEqual(selected,[...Array.from({length:12},(_,i)=>'c'+i),'video','catalogue']);
});

test('21 bidirectional selector sweeps give each of 12 cards exclusive ownership',()=>{
 const doc=fixture(),cards=[...doc.querySelectorAll('#grid a')],selector=emulate(cardHover.selector);
 for(let run=0;run<21;run++)for(const card of run%2?[...cards].reverse():cards){
  for(const other of cards)other.removeAttribute('data-qa-hover');
  card.setAttribute('data-qa-hover','');assert.deepEqual([...doc.querySelectorAll(selector)],[card]);
 }
 for(const card of cards)card.removeAttribute('data-qa-hover');
 assert.equal(doc.querySelectorAll(selector).length,0);
});

test('button hover and press ignore disabled, aria-disabled and busy states',()=>{
 const doc=fixture(),button=doc.querySelector('#primary');
 const hover=emulate(rules.find(r=>has(r,'filter','brightness(1.06)')).selector);
 const active=emulate(rules.find(r=>has(r,'transition-duration','--la-press-duration')).selector);
 button.setAttribute('data-qa-hover','');button.setAttribute('data-qa-active','');
 assert(button.matches(hover));assert(button.matches(active));
 for(const [attribute,value] of [['disabled',''],['aria-disabled','true'],['aria-busy','true']]){
  button.setAttribute(attribute,value);assert(!button.matches(hover));assert(!button.matches(active));button.removeAttribute(attribute);
 }
});

test('inputs have a focus ring without entering a movement contract',()=>{
 const doc=fixture();
 for(const id of ['input','select','textarea']){
  const input=doc.getElementById(id);input.setAttribute('data-qa-hover','');input.setAttribute('data-qa-focus','');
  for(const rule of rules.filter(r=>!r.parent.name?.endsWith('keyframes')&&!r.selector.includes('::')&&(has(r,'transform','translate')||has(r,'transform','scale('))))assert(!input.matches(emulate(rule.selector)),id+' must stay still');
  assert(rules.some(r=>has(r,'box-shadow','4px')&&input.matches(emulate(r.selector))));
 }
});

test('selected tabs and filters keep their selected fill while the pointer crosses them',()=>{
 const doc=fixture();for(const id of ['tab','secondary']){
  const e=doc.getElementById(id);e.setAttribute('data-qa-hover','');
  const fills=rules.filter(r=>r.selector.includes(':hover')&&has(r,'background-color','workspace-sunken'));
  assert(!fills.some(r=>e.matches(emulate(r.selector))),id+' selected background');
 }
});

test('decorative arrows reserve space, ignore pointer input and reveal on keyboard focus',()=>{
 const arrow=rules.find(r=>has(r,'clip-path','polygon('));
 assert(has(arrow,'pointer-events','none'));assert(has(arrow,'position','absolute'));assert(has(arrow,'opacity','0'));
 assert(arrow.nodes.filter(n=>n.prop==='transition').every(n=>!/(width|height|top|left|all)/.test(n.value)));
 const focus=rules.find(r=>r.selector.includes(':focus-visible')&&r.selector.endsWith('::after')&&has(r,'opacity','1'));
 const doc=fixture(),card=doc.querySelector('#c0');card.setAttribute('data-qa-focus','');
 assert(card.matches(emulate(focus.selector).replace(/::after/g,'')));
 card.setAttribute('aria-busy','true');
 assert(!card.matches(emulate(focus.selector).replace(/::after/g,'')));
 assert(!card.matches(emulate(arrow.selector).replace(/::after/g,'')));
 assert(!doc.querySelector('#stats').matches(emulate(focus.selector).replace(/::after/g,'')));
});

test('desktop hover and touch press share the same visual feedback',()=>{
 const desktop=cardHover.parent;
 assert.equal(desktop.name,'media');assert.equal(desktop.params,'(hover:hover) and (pointer:fine)');
 const touch=ast.nodes.find(n=>n.type==='atrule'&&n.params==='(hover:none), (pointer:coarse)');
 const effect=rule=>[rule.selector.replaceAll(':active',':hover'),rule.nodes.map(d=>[d.prop,d.value,d.important])];
 assert.deepEqual(touch.nodes.map(effect),desktop.nodes.filter(r=>r.selector.includes(':hover')).map(effect));
 const doc=fixture(),card=doc.querySelector('#c0');
 const touchCard=emulate(touch.nodes.find(r=>has(r,'transform','var(--la-hover-card-lift)')).selector);
 card.setAttribute('data-qa-hover','');assert(!card.matches(touchCard));
 card.setAttribute('data-qa-active','');assert(card.matches(touchCard));
 card.setAttribute('aria-busy','true');assert(!card.matches(touchCard));card.removeAttribute('aria-busy');
 card.removeAttribute('data-qa-active');assert(!card.matches(touchCard));
});

test('shared interaction travel and timing are independent of screen width',()=>{
 ast.walkAtRules('media',rule=>rule.walkDecls(/^--la-(?:hover|press|transition)/,d=>assert.fail(d.toString())));
 for(const rule of rules.filter(r=>has(r,'transition','var(--la-transition)')||has(r,'transition','120ms ease-out'))){
  const duration=rule.nodes.find(d=>d.prop==='transition-duration');
  assert(duration?.important,rule.selector);
  assert.equal(duration.value,has(rule,'transition','120ms ease-out')?'120ms':'var(--la-transition-duration)');
 }
 assert(rules.some(r=>r.nodes.some(d=>d.prop==='transition-duration'&&d.value==='var(--la-press-duration)'&&d.important)));
 assert(!css.includes('will-change'));assert(!css.includes('transition-delay'));
});

test('first-party site assets do not branch on the system motion preference',()=>{
 const base=new URL('../',import.meta.url);
 const assets=['index.html'];
 for(const folder of ['css','js','modules','campus/v2/src']){
  assets.push(...readdirSync(new URL(folder,base),{recursive:true})
   .filter(name=>/\.(?:css|js|mjs)$/.test(name))
   .map(name=>`${folder}/${name}`));
 }
 for(const name of assets){
  const source=readFileSync(new URL(name,base),'utf8');
  assert.doesNotMatch(source,/prefers-reduced-motion|motion-(?:reduce|safe):/i,name);
 }
});
