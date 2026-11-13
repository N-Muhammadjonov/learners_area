import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
import {setup} from './staff-final30/harness.mjs';
import {colorCascade, contrastRatio} from './helpers/css-contrast.mjs';

const readingCSS=fs.readFileSync(new URL('../modules/reading/reading-workspace.css',import.meta.url),'utf8');
const siteCSS=fs.readFileSync(new URL('../css/source.css',import.meta.url),'utf8');
const start=siteCSS.indexOf(':root,\n[data-theme="day"]');
const end=siteCSS.indexOf('/* ---------------------------------------------------------------------------\n   Shell geometry',start);
assert(start>=0&&end>start,'Site theme palette must exist');
const themeCSS=siteCSS.slice(start,end);

function paperFixture(wrapped){
 const exam=`<section class="reading-focus" data-reading-full-focus>
  <section class="reading-exam-intro"><article class="card" data-check="intro">Reading test</article></section>
  <div class="reading-workspace" data-reading-workspace>
   <header class="reading-workspace-header" data-check="header"><h1>Academic Reading</h1></header>
   <div class="reading-workspace-panels">
    <section class="reading-workspace-passage" data-check="passage">
     <article data-reading-source data-check="source"><p data-check="paragraph">Passage text</p></article>
    </section>
    <div class="reading-workspace-divider"></div>
    <section class="reading-workspace-questions" data-check="questions">
     <div class="reading-question-group"><div class="card" data-check="card">
      <div data-group-instructions><p data-check="instructions">Choose one word.</p></div>
      <div data-question><label data-check="label" for="answer">Answer</label>
       <input id="answer" data-answer-input data-check="input" placeholder="Your answer"></div>
     </div></div>
    </section>
   </div>
   <footer class="reading-workspace-footer" data-check="footer">
    <div class="reading-workspace-action"><button class="btn-primary" data-submit-attempt data-check="action">Check answers</button></div>
   </footer>
  </div>
 </section>`;
 return wrapped?`<div data-ui-system="true">${exam}</div>`:exam;
}

test('Reading uses the site Day/Night theme, not frozen light-only palette variables',()=>{
 assert.doesNotThrow(()=>postcss.parse(readingCSS));
 assert.match(readingCSS,/\.reading-focus\s*\{[^}]*color-scheme:\s*inherit\s*;/);
 assert.doesNotMatch(readingCSS,/\.reading-focus\s*\{[^}]*--(?:paper|ink-900|accent):/);
 assert.doesNotMatch(readingCSS,/color-scheme:\s*light\s*;/);
 assert.doesNotMatch(readingCSS,/rgb\(var\(--[\w-]+\)\)[\da-f]{2}\b/i);
 assert.doesNotMatch(readingCSS,/background:\s*(?:#fff\b|white\b)/i);
 assert.match(readingCSS,/rgb\(var\(--paper-raised\)\)/);
 assert.match(readingCSS,/rgb\(var\(--ink-900\)\)/);
});

for(const wrapped of [false,true]){
 for(const theme of ['day','night']){
  test(`Reading ${theme} contrast and surfaces ${wrapped?'inside focus shell':'as standalone focus'}`,()=>{
   const h=setup({path:'/app/reading/attempts/00000000-0000-4000-8000-000000000099',role:'student',theme});
   try{
    document.documentElement.dataset.theme=theme;
    h.ctx.root.innerHTML=paperFixture(wrapped);
    const cascade=colorCascade(document,[themeCSS,readingCSS]);
    for(const node of h.qa('[data-check]')){
     const {color,background}=cascade.get(node);
     const contrast=contrastRatio(color,background);
     assert(contrast>=4.5,`${theme} ${node.dataset.check} contrast ${contrast.toFixed(2)}`);
    }
    assert.equal(cascade.unknown.size,0,[...cascade.unknown].join(', '));
   }finally{h.dispose();}
  });
 }
 test(`Reading theme toggle repaints existing answers ${wrapped?'inside shell':'outside shell'}`,()=>{
  const h=setup({path:'/app/reading/attempts/00000000-0000-4000-8000-000000000099',role:'student'});
  try{
   h.ctx.root.innerHTML=paperFixture(wrapped);
   const answer=h.q('[data-answer-input]');
   answer.value='preservation';
   document.documentElement.dataset.theme='day';
   const light=colorCascade(document,[themeCSS,readingCSS]).get(h.q('[data-check="passage"]')).background;
   document.documentElement.dataset.theme='night';
   const dark=colorCascade(document,[themeCSS,readingCSS]).get(h.q('[data-check="passage"]')).background;
   assert.notDeepEqual(light,dark,'The same paper switches color when the global theme changes');
   assert.equal(h.q('[data-answer-input]'),answer,'The answer field must not remount');
   assert.equal(answer.value,'preservation','Typed answers survive the theme toggle');
  }finally{h.dispose();}
 });
}
