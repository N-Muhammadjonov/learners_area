import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { readingPassages, readingQuestions } from "../src/db/schema";
import { readingTypeFacets, readingTypePassages } from "../src/lib/data/reading-type-index";
import { getPassageWithQuestions } from "../src/lib/data/reading";
import { listLibraryFacets, listLearningLibrary } from "../src/lib/data/reading-library";
import { saveGeneralProgress } from "../src/lib/data/general-reading";

test("READ-TYPE-INDEX actual SQL: published material, canonical-first aliases, no duplicate cards, bounded pages", async () => {
  const env = await createTestDatabase();
  try {
    const ids = (await env.db.insert(readingPassages).values(Array.from({ length: 27 }, (_, i) => ({ title: `Fixture ${i}`, bodyText: "Only QA text", publicationState: i === 26 ? "draft" as const : "published" as const }))).returning()).map(p => p.id);
    await env.db.insert(readingQuestions).values(ids.flatMap((passageId, i) => [1,2].map(order => ({ passageId, order, type:"multiple_choice" as const, typeCode: i%2 ? "MH" : "matching_headings", questionText:"Match", correctAnswer:"A", explanation:"Authored" }))));
    const facets = await readingTypeFacets(env.db);
    assert.equal(facets.find(t => t.id === "matching_headings")?.count,26);
    assert.ok(!facets.some(t => t.id === "MH"));
    assert.equal((await readingTypePassages("MH",1,env.db)).length,0,"aliases are not canonical filter IDs");
    const first = await readingTypePassages("matching_headings",1,env.db);
    assert.equal(first.length,25,"24 cards plus next-page sentinel");
    assert.equal(new Set(first.map(p => p.id)).size,25);
    assert.ok(!first.some(p => p.id === ids[26]));
    assert.equal((await readingTypePassages("matching_headings",2,env.db)).length,2);
    assert.equal((await readingTypePassages("multiple_choice",1,env.db)).length,0,"storage enum/options do not override the canonical matching type");
    const [yes]=await env.db.insert(readingQuestions).values({passageId:ids[0]!,order:3,type:'true_false_not_given',typeCode:'TFNG',questionText:'Source YES/NO question',correctAnswer:'yes',acceptedAnswers:['YES'],answerConstraint:{allowed_values:['YES','NO','NOT GIVEN']},explanation:''}).returning();
    const [sentence]=await env.db.insert(readingQuestions).values({passageId:ids[0]!,order:4,type:'short_answer',typeCode:'SEN',questionText:'A source sentence blank',correctAnswer:'monastery',explanation:''}).returning();
    const updated=await readingTypeFacets(env.db);
    assert.equal(updated.find(t=>t.id==='yes_no_not_given')?.count,1);
    assert.equal(updated.find(t=>t.id==='sentence_completion')?.count,1);
    assert.ok(!updated.some(t=>t.id==='true_false_not_given'));
    assert.equal((await readingTypePassages('yes_no_not_given',1,env.db))[0]!.id,ids[0]);
    assert.equal((await readingTypePassages('sentence_completion',1,env.db))[0]!.id,ids[0]);
    const detail=(await getPassageWithQuestions(ids[0]!,env.db))!;
    assert.equal(detail.questions.find(q=>q.id===yes!.id)!.typeCode,'yes_no_not_given','the student receives YES/NO controls');
    assert.equal((await env.query<{type_code:string}>("select type_code from reading_questions where id=$1",[yes!.id]))[0]!.type_code,'TFNG','original source metadata is retained');
    const [set]=await env.query<{id:string}>("insert into general_reading_sets(title) values('Source compatibility fixture') returning id");
    await env.query("insert into general_reading_passages(passage_id,set_id,passage_no) values($1,$2,1)",[ids[0],set!.id]);
    const [user]=await env.query<{id:string}>("insert into users(name) values('Source compatibility student') returning id");
    const answers=Object.fromEntries(detail.questions.map(q=>[q.id,q.correctAnswer]));
    assert.equal((await saveGeneralProgress({userId:user!.id,role:'student',passageId:ids[0]!,answers,check:true},env.db))!.progress.score,4);
    assert.equal((await saveGeneralProgress({userId:user!.id,role:'student',passageId:ids[0]!,answers:{...answers,[yes!.id]:'TRUE'},check:true},env.db))!.progress.score,3,'a TRUE answer is not silently accepted in an authored YES/NO task');
    assert.ok(sentence);
  } finally { await env.close(); }
});


test("General type dropdown merges aliases, counts passages and excludes unpublished material", async () => {
  const env=await createTestDatabase();
  try {
    const passages=await env.db.insert(readingPassages).values([
      {title:"Health",bodyText:"QA",topicCode:"health",publicationState:"published"},
      {title:"Science",bodyText:"QA",topicCode:"science",publicationState:"published"},
      {title:"Draft",bodyText:"QA",publicationState:"draft"},
      {title:"Hidden set",bodyText:"QA",publicationState:"published"},
    ]).returning();
    const sets=await env.query<{id:string}>("insert into general_reading_sets(title,publication_state) values ('Visible','published'),('Hidden','draft') returning id");
    for(const [index,passage] of passages.entries()) await env.query("insert into general_reading_passages(set_id,passage_id,passage_no) values($1,$2,$3)",[sets[index===3?1:0]!.id,passage.id,index===3?1:index+1]);
    await env.db.insert(readingQuestions).values(passages.flatMap(p=>[
      {passageId:p.id,order:1,type:"short_answer" as const,typeCode:"SEN",questionText:"A blank",correctAnswer:"one",explanation:"QA"},
      {passageId:p.id,order:2,type:"short_answer" as const,typeCode:"sentence_completion",questionText:"Another blank",correctAnswer:"two",explanation:"QA"},
    ]));
    await env.db.insert(readingQuestions).values({passageId:passages[0]!.id,order:3,type:"true_false_not_given",typeCode:"TFNG",questionText:"Source YES/NO",correctAnswer:"yes",explanation:"QA",answerConstraint:{allowed_values:["YES","NO","NOT GIVEN"]}});
    const facets=await listLibraryFacets(true,env.db);
    assert.deepEqual(facets.types.map(t=>t.code).sort(),["sentence_completion","yes_no_not_given"]);
    assert.equal(facets.types.find(t=>t.code==="sentence_completion")?.count,2,"two passages, not four questions or two alias rows");
    assert.equal(facets.types.find(t=>t.code==="yes_no_not_given")?.count,1,"use authored answer choices");
    assert.deepEqual(facets.topics.map(t=>t.code).sort(),["health","science"]);
    const [user]=await env.query<{id:string}>("insert into users(name) values('General filter QA') returning id");
    for(const type of ["SEN","sentence_completion"]) {
      const library=await listLearningLibrary(user!.id,{type},env.db);
      assert.equal(library.total,2);
      assert.equal(new Set(library.items.map(p=>p.id)).size,2);
    }
  } finally {await env.close();}
});
