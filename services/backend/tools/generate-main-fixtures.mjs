/** Execute the pinned main's real functions. Development only; no runtime dependency. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const source=resolve(process.env.MAIN_REFERENCE_ROOT||'../work/main-reference');
process.chdir(source);process.env.AUTH_SECRET='unit-test-only-parity-secret';process.env.DATABASE_URL='postgresql://test:test@localhost/parity';
globalThis.__learnersAreaPool={on(){}};
const imported={};
async function load(path){imported[path]=createHash('sha256').update(readFileSync(source+'/src/lib/'+path+'.ts')).digest('hex');return import(pathToFileURL(source+'/src/lib/'+path+'.ts'));}
const grammar=await load('services/grammar/mastery'),forms=await load('services/lexical/forms'),reading=await load('services/reading/grading'),questions=await load('reading/question-model'),srs=await load('services/vocabulary/srs'),retention=await load('retention/evaluator'),writing=await load('services/coach/providers/riwi/writing'),speaking=await load('services/coach/providers/riwi/speaking'),presentation=await load('dictionary/presentation');
const cases=[];let number=0;
function add(kind,input,expected){cases.push({id:kind+'-'+String(++number).padStart(4,'0'),kind,input,expected});}
for(const answer of ['I have studied German for years.','I am learning English.','Although buses cost less, people prefer cars.','He prefers to walk.','I haven’t gone.','I have\u0085studied','café','I like café music','😀 have studied 😀','İ STUDY','I have\ufeffstudied','have     studied'])for(const structures of [['have studied'],['although prefer'],['prefer'],['café'],[''],['have studied','learn'],[]]){const check=grammar.checkStructures(answer,structures);add('structures',{answer,structures},{...check,verdict:grammar.structureVerdict(check,structures.length>0)});}
for(const term of ['run','go','lie','stop','study','be','shed pounds','take into account','child','person','analysis','mouse','high','low','long','old','o‘qish','CＡＦÉ','don’t','a lot of'])for(const pos of ['verb','v.','noun','n.','adjective','adverb','r','phrasal verb','(n)','phr'])add('forms',{term,pos},forms.formsOf(term,pos));
const answers=['','A','a — animals','A) animals','B','not_given','NOT GIVEN','  dog.  ','dog .','dog\u0085','dog\ufeff','40 mm','40 millimetres','A, C','C and A','A;A','A, C, D','o‘qish',' o\u02bbqish ','50,000','three thousand'];
for(const answer of answers)for(const key of ['A','A — animals','NOT GIVEN','dog','40 millimetres','o\u02bbqish'])add('reading',{answer,key,accepted:['40 mm']},reading.gradeAnswer(answer,key,['40 mm']));
for(const type of ['short_answer','sentence_completion','multiple_choice','mcq_multi','true_false_not_given','matching_headings'])for(const answer of answers){const q={type,correctAnswer:type==='mcq_multi'?'A, C':'A',acceptedAnswers:[],options:['animals','birds','cars','doors'],answerConstraint:{max_words:3}};add('reading_question',{answer,q},questions.gradeReadingQuestion(answer,q));}
const now='2026-10-24T00:00:00.000Z';
for(const stage of [-3,-1,0,1,2,3,4,8])for(const correctCount of [0,1,3])for(const activeUseCount of [0,1])for(const outcome of ['correct','incorrect']){const entry={srsStage:stage,correctCount,incorrectCount:1,activeUseCount};add('srs',{entry,outcome,now},srs.applyReview(entry,outcome,new Date(now)));}
const measurement=await load('retention/measurement');
const structure=measurement.validateMeasurementStructure({schemaVersion:1,maxScore:100,claims:[{id:'fact',label:'Company foundation',points:100,scope:'sentence',groups:[{id:'company',points:40,kind:'concept',anyOf:['company','business']},{id:'date',points:60,kind:'date',anyOf:['1998'],critical:true}],rejectPhrases:['the company closed']}]});
for(const text of ['The company was founded in 1998.','The business began in 1998.','The company was not founded in 1998.','The company closed.','company, 1998','Company founded 1998','The company was founded.','1998.','This is not true: the company was founded in 1998.','The company was founded in 1999.','The company was founded in 1998, but that is not correct.','The company was founded in nineteen ninety eight.',''])add('retention',{text,structure},retention.evaluateRecall(text,structure));
for(const content of ['Some thoughts.','I think that education is important. Students learn skills. However, schools need support.','I am agree with this. He go to school every day.','The chart shows a rise from 10 to 40 percent. Overall, most categories increased.','Education is important.\n\n'+'Students can learn skills from experience. '.repeat(40)+'\n\nHowever, public schools need support.','I think education is good because education is good because education is good.'])for(const taskType of ['task1','task2']){const input={taskType,prompt:'Discuss education.',content,targetWordCount:taskType==='task1'?150:250};add('writing',input,writing.evaluateWritingWithRiwi(input));}
const dedupe=await load('services/vocabulary/dedupe');
const questionTypes=await load('content/question-types');
for(const alias of [...new Set(questionTypes.questionTypesFor('listening').flatMap(t=>[t.id,...t.importShapes])),'unknown',' MCQ ']){
 const value=questionTypes.resolveQuestionType(alias,'listening');
 add('listening_type',{alias},value?{id:value.id,storageType:value.storageType}:null);
}
for(const term of ['The bank','o‘qish','a lot of','study',"don't",'ＦＯＯ','Run','take off'])for(const partOfSpeech of ['noun','n.','(n)','N.Phrase','v.phrase','(verb)','adv.','r',null])for(const meaning of ['To learn.','  TO  LEARN. ','The edge; the side','']){
 const input={term,partOfSpeech,meaning};add('sense_identity',input,{key:dedupe.senseKeyOf(input),legacy:dedupe.legacySenseKeyOf(input)});
}
const auth=await load('validation/auth');
for(const [mode,schema]of Object.entries({login:auth.loginSchema,register:auth.registerSchema,request:auth.requestResetSchema,confirm:auth.confirmResetSchema})){
 const valid={name:'Test Learner',email:'Learner@Example.test',password:'Password123!',gender:'male',token:'test-reset-token'};
 for(const body of [null,[],true,7,{},valid,...['name','email','password','gender','token'].flatMap(field=>[null,7,false,[],{},'', 'a', '😀😀😀😀', ' '.repeat(4)].map(value=>({...valid,[field]:value})))]){
  const parsed=schema.safeParse(body);add('auth_validation',{mode,body},parsed.success?{value:parsed.data,error:null}:{value:null,error:parsed.error.issues[0].message});
 }
}
const admin=await load('validation/admin');
const adminSchemas={passage:[admin.createPassageSchema,{title:'A valid passage',bodyText:'A sufficiently long passage body for this validation case.',difficultyLevel:'B2',suggestedMinutes:'20'}],grammar_topic:[admin.createGrammarTopicSchema,{skillArea:'writing',title:'A valid topic',explanation:'A valid explanation.'}],grammar_exercise:[admin.createGrammarExerciseSchema,{promptText:'Choose a form',options:['A','B'],correctOption:'A',explanation:'A valid explanation.',sourceSubmissionId:'aa000000-0000-4000-8000-000000000001'}],listening_test:[admin.createListeningTestSchema,{title:'A valid lesson',audioType:'file',audioUrl:'https://example.test/audio.mp3',difficultyLevel:'B2'}],reading_question:[admin.createReadingQuestionSchema,{type:'short_answer',questionText:'What is the answer?',correctAnswer:'A',explanation:'A valid explanation.'}],listening_question:[admin.createListeningQuestionSchema,{type:'short_answer',questionText:'What is the answer?',correctAnswer:'A',explanation:'A valid explanation.'}]};
for(const [mode,[schema,valid]]of Object.entries(adminSchemas))for(const body of [null,[],{},valid,...Object.keys(valid).flatMap(field=>[null,7,false,[],[null],{},'',1.5,'0x20','Infinity'].map(value=>({...valid,[field]:value})))]){
 const parsed=schema.safeParse(body);add('admin_validation',{mode,body},parsed.success?{value:parsed.data,error:null}:{value:null,error:parsed.error.issues[0].message});
}
for(const part of ['part1','part2','part3','general','mock'])for(const durationMs of [null,15000,90000])for(const transcript of ['I enjoy learning languages. It helps me understand people.','Um I think that it is like really interesting, you know.','He go to school. I am agree with him.','I enjoy learning new skills. '.repeat(32)]){
 const input={part,promptText:'Talk about learning.',transcript,transcriptOrigin:'manual',durationMs,pronunciationAvailable:false};add('speaking',input,speaking.evaluateSpeakingWithRiwi(input));
}
const entry={schema_version:'1.0.0',release_id:'rel-v1-'+'a'.repeat(24),lexeme_id:'aa000000-0000-4000-8000-000000000001',display_lemma:'take off',normalized_search_form:'take off',lexical_type:'phrasal_verb',part_of_speech:'v',homograph_group:null,is_satellite:false,pronunciations:[],forms:[{surface_form:'took off'}],senses:[{sense_id:'aa000000-0000-4000-8000-000000000002',definition_en:'To remove an item.',definition_uz:'Biror narsani yechmoq.',translations:[{translation_id:'aa000000-0000-4000-8000-000000000003',text:'Yechmoq',order:0}],examples:[{example_id:'aa000000-0000-4000-8000-000000000004',text_en:'She took her shoes off.',text_uz:'U oyoq kiyimini yechdi.'},{example_id:'aa000000-0000-4000-8000-000000000005',text_en:'They walked home.',text_uz:'Ular uyga yurishdi.'}]}],relations:[],collocations:[],attribution:[{source_name:'Learners Area',snapshot_id:'parity',creator:'Learners Area',source_url:'',license_reference:'Owned',license_url:'',attribution_text:'Parity fixture'}]};
const model=await load('dictionary/model');const revisions=await load('dictionary/translation-revisions');const context=await load('dictionary/context-form');
for(const polysemy of [false,true]){
 const value=structuredClone(entry);if(polysemy)value.senses.push({...structuredClone(entry.senses[0]),sense_id:'aa000000-0000-4000-8000-000000000006',definition_en:'For a plane to leave the ground.'});
 value.relations=[{relation_type:'synonym',source_sense_id:value.senses[0].sense_id,target_lexeme_id:'bb000000-0000-4000-8000-000000000001',display_lemma:'remove',part_of_speech:'v',lexical_type:'word'},{relation_type:'synonym',target_lexeme_id:'cc000000-0000-4000-8000-000000000001',display_lemma:'depart',part_of_speech:'v',lexical_type:'word'}];
 add('dictionary_presentation',{entry:value},presentation.dictionaryPresentation(value));
}
for(const surface of ['take off','took off','taken off','took it off','taking his old coat off','not take off']){
 const parts=surface==='took it off'?[{start:0,end:4},{start:8,end:11}]:undefined;
 add('context_form',{entry,surface,...(parts?{parts}: {})},context.matchesDictionaryContextForm(entry,surface,parts));
}
const plan={version:1,status:'ai_editorial_draft_not_published',rows:[{entryId:entry.lexeme_id,senseId:entry.senses[0].sense_id,meaningSha:model.senseMeaningHash(entry,entry.senses[0]),beforeTranslationSha:revisions.translationContentHash(entry.senses[0]),translationUz:'Yechib tashlamoq',definitionUz:'Kiyimni yechib tashlash.',reason:'Explicit source checked correction'}]};
add('translation_revision',{entries:[entry],plan},revisions.reviseDictionaryTranslations([entry],plan));
writeFileSync(root+'/services/backend/tests/main-function-fixtures.json',JSON.stringify({sourceCommit:'b62b78f469e4f73aa80f441f630b012dc422af39',sourceSha256:imported,cases},null,2)+'\n');
console.log(JSON.stringify({fixtures:cases.length,groups:Object.fromEntries([...new Set(cases.map(c=>c.kind))].map(k=>[k,cases.filter(c=>c.kind===k).length]))}));
