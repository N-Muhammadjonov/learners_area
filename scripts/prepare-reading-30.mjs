import fs from 'node:fs';
import crypto from 'node:crypto';
import {JSDOM} from 'jsdom';
const [sourceFile,existingFile,output='/tmp/reading30-import']=process.argv.slice(2);
if(!sourceFile||!existingFile)throw Error('Usage: node scripts/prepare-reading-30.mjs source.html existing-passages.json output-directory');
const original=fs.readFileSync(sourceFile,'utf8'),encoded=JSON.parse(original.match(/<script[^>]*id=["']la-tests-data["'][^>]*>([\s\S]*?)<\/script>/)[1]);
const existing=JSON.parse(fs.readFileSync(existingFile,'utf8'));if(existing.some(p=>p.source_ref?.startsWith('reading30:')))throw Error('This source pack is already imported; existing content must not be duplicated.');
const raw=[];
for(const [number,base64] of Object.entries(encoded)){
 const html=Buffer.from(base64,'base64').toString('utf8'),scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
 const d=new JSDOM(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style[^>]*>[\s\S]*?<\/style>/g,''),{runScripts:'outside-only',url:'https://fixture.invalid'});
 try{d.window.eval(scripts[0][1]+';'+scripts[1][1]+';window.EXTRACT={passages:PASSAGES,keys:AK,ranges:pRanges,questions:[renderQ(1),renderQ(2),renderQ(3)],meta:window.LA_EXPLANATIONS};');raw.push({test:Number(number),...JSON.parse(JSON.stringify(d.window.EXTRACT))});}finally{d.window.close();}
}
const plain=html=>{const d=new JSDOM(html);const s=d.window.document.body.textContent.replace(/\s+/g,' ').trim();d.window.close();return s;};
const grams=text=>{const words=text.normalize('NFKC').toLowerCase().match(/[a-z0-9]+/g)||[];return new Set(words.slice(0,-4).map((_,i)=>words.slice(i,i+5).join(' ')));};
const score=(a,b)=>{let common=0;for(const v of a)if(b.has(v))common++;return common/Math.min(a.size,b.size);};
const seen=existing.map(p=>({id:p.id,title:p.title,g:grams(p.body_text)})),dedupe=[];
for(const t of raw.sort((a,b)=>a.test-b.test))for(const [part,html] of Object.entries(t.passages)){
 const body=plain(html),g=grams(body),matches=seen.map(p=>({score:score(g,p.g),id:p.id,title:p.title})).sort((a,b)=>b.score-a.score),best=matches[0],duplicate=best.score>.8;
 dedupe.push({test:t.test,part:Number(part),title:body.slice(0,100),duplicate,matchScore:best.score,matchId:best.id,matchTitle:best.title});if(!duplicate)seen.push({id:'new:'+t.test+':'+part,title:body.slice(0,100),g});
}

const uid=s=>{const h=crypto.createHash('sha256').update('learners-area:reading30:'+s).digest('hex').slice(0,32).split('');h[12]='5';h[16]='8';const a=h.join('');return `${a.slice(0,8)}-${a.slice(8,12)}-${a.slice(12,16)}-${a.slice(16,20)}-${a.slice(20)}`;};
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const tags=new Set('div p span strong b em i u sup sub br table thead tbody tfoot tr td th ul ol li h2 h3 h4 img label input select option fieldset legend'.split(' '));
function sanitize(node){for(const e of [...node.querySelectorAll('*')]){if(!tags.has(e.localName)){if(['script','style','iframe','object','embed','form','link'].includes(e.localName))e.remove();else e.replaceWith(...e.childNodes);continue;}for(const a of [...e.attributes])if(!['class','type','value','placeholder','colspan','rowspan','alt','src','data-source-numbers'].includes(a.name))e.removeAttribute(a.name);if(e.localName==='img'&&!/^data:image\/(png|jpe?g|webp);base64,/i.test(e.getAttribute('src')||''))e.removeAttribute('src');}}
function numbers(n){const on=n.getAttribute('onchange')||n.getAttribute('onclick')||'',single=/setAns\((\d+)/.exec(on);if(single)return [+single[1]];if(n.type==='checkbox'){let a,b;if(n.dataset.q1){a=+n.dataset.q1;b=+n.dataset.q2;}else{const m=on.match(/(?:ctChange\(|this,|,)(\d+),(\d+)\)?/);if(m){a=+m[1];b=+m[2];}}if(!a){const m=clean(n.closest('.qs')?.querySelector('.qs-instr')?.textContent).match(/Questions?\s+(\d+)\s*(?:[–—-]|and)\s*(\d+)/i);if(m){a=+m[1];b=+m[2];}}if(a&&b)return Array.from({length:b-a+1},(_,i)=>a+i);}throw Error('Unmapped control '+n.outerHTML);}
function kind(group,nodes){const ins=group.querySelector('.qs-instr')?.textContent||'';if(/TRUE/.test(ins)&&/FALSE/.test(ins))return 'true_false_not_given';if(/\bYES\b/.test(ins)&&/\bNO\b/.test(ins))return 'yes_no_not_given';const text=clean(group.textContent).toLowerCase();if(nodes[0]?.type==='checkbox')return 'multiple_choice';if(nodes.some(n=>n.type==='radio')){const vals=nodes.map(n=>n.value.toUpperCase());if(vals.includes('TRUE'))return 'true_false_not_given';if(vals.includes('YES'))return 'yes_no_not_given';return 'multiple_choice';}if(nodes[0]?.localName==='select'){if(/heading/.test(text))return 'matching_headings';if(/paragraph|contains.*information/.test(text))return 'matching_information';if(/sentence.*ending/.test(text))return 'matching_sentence_endings';return 'matching_features';}if(group.querySelector('table'))return 'table_completion';if(/summary/.test(text))return 'summary_completion';if(/notes/.test(text))return 'note_completion';if(/diagram/.test(text))return 'diagram_label_completion';return 'sentence_completion';}
const passages=[],presentation={};
for(const row of dedupe.filter(r=>!r.duplicate)){
 const source=raw.find(r=>r.test===row.test),part=row.part,pid=uid('passage:'+row.test+':'+part),d=new JSDOM(source.passages[part]),doc=d.window.document;
 const title=clean(doc.querySelector('.pass-title,.ptitle,h1,h2')?.textContent)||'Reading Passage '+part;
 const paras=[...doc.querySelectorAll('.pass-body p')];if(!paras.length)paras.push(...doc.querySelectorAll('p'));
 const paragraphs=paras.map((p,i)=>({id:uid(pid+':p:'+i),position:i+1,label:null,text:clean(p.textContent),is_footnote:false})).filter(p=>p.text);
 const body=paragraphs.length?paragraphs.map(p=>p.text).join('\n\n'):clean(doc.body.textContent);
 sanitize(doc.body);const passageHtml=doc.body.innerHTML;d.window.close();
 const qdom=new JSDOM(source.questions[part-1]),qd=qdom.window.document,groups=[],questions=[],templates={};
 for(const [index,g] of [...qd.querySelectorAll('.qs')].entries()){
  const controls=[...g.querySelectorAll('input,select')];if(!controls.length)continue;
  const gid=uid(pid+':g:'+index),instruction=clean(g.querySelector('.qs-instr')?.textContent),allNumbers=new Set(),byN=new Map();
  for(const node of controls){if(node.type==='checkbox'&&!node.hasAttribute('value')){const m=(node.getAttribute('onchange')||'').match(/['\"]([A-Z])['\"]/);if(m)node.value=m[1];}const ns=numbers(node);node.dataset.sourceNumbers=ns.join(',');for(const n of ns){allNumbers.add(n);const nodes=byN.get(n)||[];nodes.push(node);byN.set(n,nodes);}}
  const ns=[...allNumbers].sort((a,b)=>a-b),typ=kind(g,controls);let maxWords;const word=instruction.match(/(?:NO MORE THAN |CHOOSE |WRITE )?(ONE|TWO|THREE|FOUR|\d+)\s+WORDS?/i);if(word)maxWords=({ONE:1,TWO:2,THREE:3,FOUR:4}[word[1].toUpperCase()]||+word[1]);
  if(['true_false_not_given','yes_no_not_given'].includes(typ)){const normalize=v=>({T:'TRUE',F:'FALSE',Y:'YES',N:'NO',NG:'NOT GIVEN',NGV:'NOT GIVEN',NOT_GIVEN:'NOT GIVEN'}[v.toUpperCase()]||v);for(const c of controls){if(c.localName==='select'){for(const o of c.options)if(o.value)o.value=normalize(o.value);}else c.value=normalize(c.value);}}
  groups.push({id:gid,passage_id:pid,position:index+1,type_code:typ,display_title:`Questions ${ns[0]}–${ns.at(-1)}`,instructions_text:instruction,from_question_no:ns[0],to_question_no:ns.at(-1),shared_choices:[]});
  for(const n of ns){const nodes=byN.get(n),node=nodes[0],type=kind(g,nodes),qid=uid(pid+':q:'+n),metadata=source.meta?.[n]||{};
   let answer=String(source.keys[n]??'').trim();if(type==='true_false_not_given')answer=({T:'TRUE',F:'FALSE',NGV:'NOT GIVEN',NG:'NOT GIVEN'}[answer.toUpperCase()]||answer);if(type==='yes_no_not_given')answer=({Y:'YES',N:'NO',NGV:'NOT GIVEN',NG:'NOT GIVEN'}[answer.toUpperCase()]||answer);
   const accepted=answer.includes('(')?[clean(answer.replace(/\([^)]*\)/g,''))]:[];answer=answer.replace(/\(([^)]+)\)/g,'$1');if(!answer)throw Error(`Missing key ${row.test}:${n}`);
   let context=node.closest('.qitem,.notes-li,tr,.hrow,.mrow')||node.closest('p')||node.parentElement;
   const clone=context.cloneNode(true);for(const x of clone.querySelectorAll('input,select'))x.replaceWith(' ___ ');for(const x of clone.querySelectorAll('.qno,.fqn,.qnum,.tfn-opts,.mcq-opts'))x.remove();
   const qtext=clean(clone.textContent)||'Choose the correct answer.';
   const opts=node.localName==='select'?[...node.options].filter(o=>o.value).map(o=>o.value):node.type==='radio'||node.type==='checkbox'?nodes.map(o=>o.value):null;
   const constraint={};if(maxWords){constraint.max_words=maxWords;if(/NUMBER/i.test(instruction)){constraint.number_allowed=true;constraint.max_words=maxWords+1;}}if(node.type==='checkbox')constraint.source_multi_group=pid+':'+node.dataset.sourceNumbers;
   if(type==='true_false_not_given')constraint.allowed_values=['TRUE','FALSE','NOT GIVEN'];if(type==='yes_no_not_given')constraint.allowed_values=['YES','NO','NOT GIVEN'];
   const quote=metadata.evidence||null,at=quote?body.indexOf(quote):-1;
   questions.push({id:qid,passage_id:pid,order:n,question_no:n,type:['true_false_not_given','yes_no_not_given','multiple_choice'].includes(type)?type:type.startsWith('matching_')?'multiple_choice':'short_answer',type_code:type,question_text:qtext,options:opts,group_id:gid,correct_answer:answer,accepted_answers:accepted,answer_constraint:constraint,explanation:metadata.explanation||'',evidence_quote:quote,evidence_start_char:at>=0?at:null,evidence_end_char:at>=0?at+quote.length:null,evidence_type:at>=0?'source_marker':'missing_source',render_mode:'source_cd'});
  }
  sanitize(g);templates[gid]=g.outerHTML;
 }
 qdom.window.close();const expected=source.ranges[part];if(questions.length!==expected[1]-expected[0]+1)throw Error(`Bad questions ${row.test}:${part}: ${questions.length}`);
 passages.push({id:pid,title:title.slice(0,200),body_text:body,difficulty_level:'B2',suggested_minutes:20,external_id:`la30-t${String(row.test).padStart(2,'0')}-p${part}`,test_no:35+row.test,passage_no:part,instructions:`You should spend about 20 minutes on this passage.`,source_ref:`reading30:passage:${row.test}:${part}`,source_word_count:body.split(/\s+/).length,source_question_count:questions.length,source_checksum:crypto.createHash('sha256').update(body).digest('hex'),groups,questions,paragraphs,sourceTest:row.test});presentation[pid]={passageHtml,groups:templates};
}
const spares=existing.filter(r=>!r.memberships?.some(m=>m.count===3)).map(r=>({...r,used:false})),sets=[];let fullNumber=35;
for(const n of Array.from({length:30},(_,i)=>i+1).sort((a,b)=>passages.filter(p=>p.sourceTest===b).length-passages.filter(p=>p.sourceTest===a).length||a-b)){
 const own=passages.filter(p=>p.sourceTest===n);if(!own.length)continue;
 const chosen=[...own],replacements=[];
 for(let part=1;part<=3;part++)if(!chosen.some(p=>p.passage_no===part)){
  const candidate=spares.find(s=>!s.used&&s.passage_no===part&&chosen.reduce((v,p)=>v+(p.questions?.length??p.questionsCount),0)+s.questions<=40);if(candidate){chosen.push({...candidate,questionsCount:candidate.questions});replacements.push(candidate);}
 }
 const full=chosen.length===3&&chosen.reduce((v,p)=>v+(Array.isArray(p.questions)?p.questions.length:p.questionsCount),0)===40;
 const members=(full?chosen:own).sort((a,b)=>a.passage_no-b.passage_no);if(full)replacements.forEach(r=>r.used=true);
 sets.push({id:uid('set:'+n),sourceTest:n,title:full?'Reading Test':'Reading Practice · Source '+n,source_ref:'reading30:source:'+String(n).padStart(2,'0'),full,members:members.map(p=>({id:p.id,part:p.passage_no,existing:!Array.isArray(p.questions)}))});
}
sets.sort((a,b)=>a.sourceTest-b.sourceTest);for(const s of sets)if(s.full)s.title='Reading Test '+(++fullNumber);
const plan={source:'Learners_Area_30_Full_Tests.html',skipped:dedupe.filter(r=>r.duplicate),passages,sets,usedSpares:spares.filter(r=>r.used).map(({body_text,...r})=>r)};
fs.mkdirSync('services/backend/assets/reading-cd',{recursive:true});fs.writeFileSync('services/backend/assets/reading-cd/presentations.json',JSON.stringify(presentation));fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/plan.json',JSON.stringify(plan));fs.writeFileSync('services/backend/assets/reading-cd/import-manifest.json',JSON.stringify({sourceSha256:crypto.createHash('sha256').update(original).digest('hex'),passages:passages.map(p=>({id:p.id,title:p.title,source:p.external_id,count:p.questions.length,checksum:p.source_checksum})),sets,skipped:plan.skipped,usedSpares:plan.usedSpares.map(p=>({id:p.id,title:p.title}))}));
console.log(JSON.stringify({newPassages:passages.length,questions:passages.reduce((n,p)=>n+p.questions.length,0),full:sets.filter(s=>s.full).length,partial:sets.filter(s=>!s.full).length,spares:plan.usedSpares.map(p=>p.title),templateBytes:fs.statSync('services/backend/assets/reading-cd/presentations.json').size}));
