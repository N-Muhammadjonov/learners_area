import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { reading105Catalogue, repairReading105Catalogue, type CatalogueConnection } from "../scripts/lib/reading-105-catalogue";
import { createTestDatabase } from "./support/pglite";
import { listGeneralSets } from "../src/lib/data/general-reading";
import { listLearningLibrary } from "../src/lib/data/reading-library";
import { startAcademicSet } from "../src/lib/data/reading-assessments";

const source = resolve("data/import-sources/learnersarea_reading_105.zip");
test("Reading 105 source preserves 33 authored groups, six standalones, four 41-question groups and the incomplete draft", () => {
  const groups = reading105Catalogue(source);
  assert.equal(groups.length, 39);
  assert.equal(groups.flatMap(g => g.passages).length, 105);
  assert.equal(groups.flatMap(g => g.passages).reduce((n, p) => n + p.questionCount, 0), 1406);
  assert.deepEqual(groups.filter(g => g.passages.reduce((n, p) => n + p.questionCount, 0) === 41).map(g => g.title), ["Reading Test 8", "Reading Test 12", "Reading Test 30", "Reading Test 31"]);
  const [held] = groups.flatMap(g => g.passages).filter(p => p.held);
  assert.equal(held!.externalId, "t29-p2-the-importance-of-law");
  assert.equal(held!.wordCount, 892);
  assert.ok(held!.bodyText.split(/\s+/).length < 600, "the truncated original is not silently repaired or published");
});

test("Reading 105 real SQL repair links original IDs once, atomically rejects conflicts, and exposes all 104 eligible passages in source order", async () => {
  const env = await createTestDatabase();
  const connection: CatalogueConnection = { query: async (text, params) => ({ rows: await env.query(text, params) }) };
  try {
    const groups = reading105Catalogue(source);
    const [owner, user] = await env.query<{id:string}>("insert into users(name,role,account_status) values ('Owner','owner','active'),('Student','student','active') returning id");
    // Actual reviewed passage bodies/metadata; question rows are synthetic relation fixtures.
    // The repair never reads/regrades/rewrites a question's text or answer.
    for (const p of groups.flatMap(g => g.passages)) {
      const [row] = await env.query<{id:string}>("insert into reading_passages(external_id,title,test_no,passage_no,source_word_count,body_text,publication_state) values($1,$2,$3,$4,$5,$6,$7) returning id", [p.externalId,p.title,p.testNo,p.passageNo,p.wordCount,p.bodyText,p.held ? 'draft' : 'published']);
      await env.query("insert into reading_questions(passage_id,\"order\",question_no,type,question_text,correct_answer,explanation) select $1::uuid,n,n,'short_answer','Fixture question','fixture answer','Fixture explanation' from generate_series(1,$2::int) n", [row!.id,p.questionCount]);
    }
    const snapshot = async () => env.query("select count(*)::int n,md5(string_agg(row_to_json(p)::text,'' order by id)) digest from reading_passages p union all select count(*)::int,md5(string_agg(row_to_json(q)::text,'' order by id)) from reading_questions q");
    const before = await snapshot();
    await assert.rejects(repairReading105Catalogue(connection,user!.id,groups,true), /active_owner_required/);
    const preview = await repairReading105Catalogue(connection,owner!.id,groups,false);
    assert.equal(preview.createdSets,39); assert.equal(preview.linked,104); assert.equal(preview.academicSets,32);
    assert.equal((await env.query<{n:number}>("select count(*)::int n from general_reading_sets"))[0]!.n,0,"dry run rolls back every relation");
    const result = await repairReading105Catalogue(connection,owner!.id,groups,true);
    assert.equal(result.totalLinked,104); assert.equal(result.held.length,1);
    assert.deepEqual(await snapshot(),before,"all 105 original identities, text, publication and 1406 questions remain byte-for-byte unchanged");
    const repeated = await repairReading105Catalogue(connection,owner!.id,groups,true);
    assert.equal(repeated.createdSets,0); assert.equal(repeated.linked,0);
    assert.equal((await env.query<{n:number}>("select count(*)::int n from audit_log where action='reading105.catalogue_repair'"))[0]!.n,1);

    const a1=await listGeneralSets(user!.id,{academic:true},env.db);
    const a2=await listGeneralSets(user!.id,{academic:true,page:2},env.db);
    const academic=[...a1.slice(0,24),...a2];
    assert.equal(academic.length,32);
    assert.deepEqual(academic.slice(0,3).map(s=>s.title),['Reading Test 1','Reading Test 2','Reading Test 3']);
    assert.equal(academic.at(-1)!.title,'Reading Test 33');
    assert.ok(!academic.some(s=>s.title==='Reading Test 29'));
    for(const no of [8,12,30,31]) assert.ok(academic.some(s=>s.title===`Reading Test ${no}`));
    const pages=await Promise.all([1,2,3,4,5].map(page=>listLearningLibrary(user!.id,{page},env.db)));
    assert.ok(pages.every(p=>p.total===104&&p.pageCount===5));
    const all=pages.flatMap(p=>p.items);
    assert.equal(new Set(all.map(p=>p.id)).size,104);
    assert.deepEqual(all.slice(0,4).map(p=>[p.testNo,p.passageNo]),[[1,1],[1,2],[1,3],[2,1]]);
    assert.equal(all.at(-1)!.title,'Child’s Play in Medieval England');
    assert.equal((await listLearningLibrary(user!.id,{query:'importance of law'},env.db)).total,0);
    assert.equal((await listLearningLibrary(user!.id,{query:'Child’s Play'},env.db)).total,1);
    const partial=result.sets.find(s=>s.sourceRef==='reading105:test:29')!;
    assert.equal(partial.linked,2,"draft child does not make two valid General passages inaccessible");
    assert.equal(await startAcademicSet(user!.id,partial.id,env.db),null);
    const oversized=result.sets.find(s=>s.sourceRef==='reading105:test:08')!;
    assert.ok(await startAcademicSet(user!.id,oversized.id,env.db),"the reviewed 40-question selection can start without deleting the 41-question General original");
    assert.ok(await startAcademicSet(user!.id,academic[0]!.id,env.db));

    // A conflict at the end must roll back relations inserted earlier in this run.
    await env.query("delete from reading_assessment_passages");
    await env.query("delete from reading_assessments");
    await env.query("delete from reading_attempts");
    await env.query("delete from general_reading_passages");
    await env.query("delete from general_reading_sets");
    const [foreign]=await env.query<{id:string}>("insert into general_reading_sets(title,source_ref) values('Other','other') returning id");
    const [last]=await env.query<{id:string}>("select id from reading_passages where external_id=$1",[groups.at(-1)!.passages[0]!.externalId]);
    await env.query("insert into general_reading_passages(passage_id,set_id,passage_no) values($1,$2,3)",[last!.id,foreign!.id]);
    await assert.rejects(repairReading105Catalogue(connection,owner!.id,groups,true),/membership_conflict/);
    assert.equal((await env.query<{n:number}>("select count(*)::int n from general_reading_sets"))[0]!.n,1);
    assert.equal((await env.query<{n:number}>("select count(*)::int n from general_reading_passages"))[0]!.n,1);
    assert.deepEqual(await snapshot(),before);
  } finally { await env.close(); }
});

test("General detail checks the live exam seal before restoring any checked answer keys", () => {
  const page=readFileSync("src/app/app/(shell)/reading/general/[setId]/page.tsx","utf8");
  assert.ok(page.indexOf('if (activeExam) redirect') < page.indexOf('const progress = await generalProgress'));
  assert.ok(page.indexOf('if (activeExam) redirect') < page.indexOf('restoredGeneralCheck(row'));
});
