import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';

test('Listening 1 original opening now links content words but not function words',()=>{
  const text='Recordings, and you will have to answer questions on what you hear.';
  const marks=[
    {part:1,start:0,end:10,surface:'Recordings',occurrenceId:'recordings',definitionEn:'an audio recording',translationUz:'audioyozuv'},
    {part:1,start:33,end:39,surface:'answer',occurrenceId:'answer',definitionEn:'to respond to a question',translationUz:'javob bermoq'},
    {part:1,start:40,end:49,surface:'questions',occurrenceId:'questions',definitionEn:'a question asking for an answer',translationUz:'savol'},
    {part:1,start:62,end:66,surface:'hear',occurrenceId:'hear',definitionEn:'to perceive a sound',translationUz:'eshitmoq'}
  ];
  const dom=new JSDOM('<div id="scriptTabs"><button data-spart="1" class="active">Part 1</button></div><div id="activity-script" class="active"><div id="scriptHost"><div class="script-transcript"></div></div></div>',{runScripts:'outside-only'});
  try {
    const w=dom.window;
    w.DATA={transcript:{'1':text},script_completion:[]};
    w.scriptPart=1;
    w.buildScriptTranscript=()=>text;
    w.renderScript=()=>null;
    w.document.querySelector('.script-transcript').textContent=text;
    w.eval(originalScriptAccessibility('fixture',marks));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const spans=[...w.document.querySelectorAll('.la-script-lexical-word')];
    assert.deepEqual(spans.map(el=>el.textContent),['Recordings','answer','questions','hear']);
    assert.deepEqual(spans.map(el=>Number(el.dataset.scriptSourceStart)),[0,33,40,62]);
    assert.equal(w.document.querySelector('.script-transcript').textContent,text);
    assert(!spans.some(el=>['and','you','will','have','to','on','what'].includes(el.textContent.toLowerCase())));
  } finally {dom.window.close();}
});

test('Listening Test local morphology migrations cover 32 tests in independent four-Part transactions',()=>{
  const root=new URL('../../../',import.meta.url);
  for(let batch=0;batch<4;batch++){
    const first=batch*8+1,last=first+7;
    const path=new URL('services/backend/migrations/'+(1110+batch)+'_listening_'+first+'_'+last+'_morphology.sql',root);
    const source=readFileSync(path,'utf8');
    const parts=[...source.matchAll(/^-- Test (\d+), Part (\d+)$/gm)];
    assert.equal(parts.length,32,'Missing independently bounded statements in '+path);
    for(let n=first;n<=last;n++)for(let part=1;part<=4;part++){
      const matches=parts.filter(row=>Number(row[1])===n&&Number(row[2])===part);
      assert.equal(matches.length,1,'Unexpected source part count in Test '+n+' Part '+part);
    }
    assert.equal((source.match(/SET LOCAL statement_timeout='55s';/g)||[]).length,32);
    assert.equal((source.match(/COMMIT;/g)||[]).length,32);
    assert.match(source,/count\(DISTINCT \(part_of_speech,definition_en,translation_uz\)\)=1/);
    assert.match(source,/start_utf16/);
    assert.doesNotMatch(source,/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)/i);
  }
});

test('Listening grammar and once corrections preserve source-owned meanings',()=>{
  const root=new URL('../../../',import.meta.url);
  const sql=readFileSync(new URL('services/backend/migrations/1114_listening_grammar_and_once_context.sql',root),'utf8');
  const backend=readFileSync(new URL('services/backend/app/step21_listening_authored_reads.py',root),'utf8');
  assert.match(sql,/on one occasion; a single time/);
  assert.match(sql,/as soon as or after the stated event happens/);
  assert.match(sql,/jsonb_set\(p.payload::jsonb,'\{contextualMeanings\}'/);
  assert.match(backend,/if is_function\(surface\) or surface.lower\(\) in function_tokens:/);
  assert.match(backend,/name_spans.get\(part/);
});
