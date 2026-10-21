import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { navigationSearch, rankSearchHits } from "../src/lib/search/navigation";
import { searchContent } from "../src/lib/search/content";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

test("global navigation finds real modules and sections in either language",()=>{
  for(const dict of [en,uz]){
    for(const area of ["reading","listening","writing","speaking","grammar"]){
      assert.ok(navigationSearch(area,dict).some(hit=>hit.href===`/app/${area}`));
    }
    assert.ok(navigationSearch("lug'at",dict).some(hit=>hit.href==="/app/vocabulary"));
    assert.ok(navigationSearch("dictionary",dict).some(hit=>hit.href==="/app/vocabulary?tab=dictionary"));
    assert.ok(navigationSearch("typing",dict).some(hit=>hit.href==="/app/writing?tab=typing"));
    assert.ok(navigationSearch("retention",dict).some(hit=>hit.href==="/app/reading/retention"));
    assert.equal(navigationSearch("x",dict).length,0);
  }
});

test("global content search finds General passages and all four test skills, with published-only and learner-owned visibility",async()=>{
 const env=await createTestDatabase();
 try{
   const [me,other]=await env.query<{id:string}>("insert into users(name) values ('Search learner'),('Other learner') returning id");
   const [set]=await env.query<{id:string}>("insert into general_reading_sets(title) values ('Search Reading Test') returning id");
   for(let n=1;n<=3;n++){
     const [passage]=await env.query<{id:string}>("insert into reading_passages(title,body_text) values ($1,'secret passage body') returning id",[`Search passage ${n}`]);
     await env.query("insert into general_reading_passages(set_id,passage_id,passage_no) values ($1,$2,$3)",[set!.id,passage!.id,n]);
     for(let q=1;q<=(n===3?14:13);q++)await env.query("insert into reading_questions(passage_id,\"order\",question_no,type,question_text,correct_answer,explanation) values($1,$2,$2,'short_answer','Private question','secret key','Private explanation')",[passage!.id,q]);
   }
   await env.query("insert into reading_passages(title,body_text) values ('Search standalone unavailable','private')");
   const [listening]=await env.query<{id:string}>("insert into listening_tests(created_by_user_id,title,audio_type) values($1,'Search Listening Test','audio') returning id",[other!.id]);
   await env.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash) values($1,'qa-search-listening',$2::jsonb,'qa-only-audio','qa')",[listening!.id,JSON.stringify({collection:'academic',sections:[],questions:[]})]);
   await env.query("insert into listening_tests(created_by_user_id,title,audio_type,publication_state,publish_at) values($1,'Search draft','audio','draft',null),($1,'Search future','audio','scheduled',now()+interval '1 day'),($1,'Search archived','audio','archived',null)",[other!.id]);
   const [writing]=await env.query<{id:string}>("insert into writing_prompts(task_type,category,prompt,target_word_count) values('task2','Search environment','Search writing question',250) returning id");
   await env.query("insert into speaking_prompts(part,category,prompt_text,topic) values('part1','general','Search speaking question','Search topic')");
   await env.query("insert into speaking_prompts(part,category,prompt_text,topic,available_in) values('part1','general','Search private AI question','Search topic','[\"ai\"]'),('general','general','Search unsupported part','Search topic','[\"practice_alone\"]')");
   const [own,foreign]=await env.query<{id:string}>("insert into lexemes(term,definition_en,sense_key) values('Search ownword','own meaning','qa-search-own'),('Search otherword','private meaning','qa-search-other') returning id");
   await env.query("insert into user_vocabulary(user_id,lexeme_id) values($1,$2),($3,$4)",[me!.id,own!.id,other!.id,foreign!.id]);
   const result=await searchContent("Search",me!.id,env.db);
   assert.equal(result.failedCategories,0);
   for(const type of ["reading","listening","writing","speaking","vocabulary"])assert.ok(result.results.some(hit=>hit.type===type),type);
   const first=result.results.find(hit=>hit.title==="Search passage 1")!;
   assert.equal(first.href,`/app/reading/general/${set!.id}?passage=1`);
   assert.ok(result.results.some(hit=>hit.title==="Search Reading Test"&&hit.href===`/app/reading/academic/${set!.id}`));
   assert.ok(result.results.some(hit=>hit.title==="Search writing question"&&hit.href===`/app/writing/prompts/${writing!.id}`));
   assert.ok(result.results.some(hit=>hit.title==="Search speaking question"&&hit.href==="/app/speaking/practice?part=part1&topic=search+topic"));
   for(const secret of ["Search draft","Search future","Search archived","Search otherword","Search standalone unavailable","Search private AI question","Search unsupported part"])
     assert.equal(result.results.some(hit=>hit.title===secret),false,secret);
   assert.equal(JSON.stringify(result).includes("secret passage body"),false);
   assert.equal(JSON.stringify(result).includes("secret key"),false);
   assert.equal((await searchContent("%",me!.id,env.db)).results.length,0,"wildcards are literal");
   const ranked=rankSearchHits([...result.results,...result.results],"Search ownword");
   assert.equal(ranked[0]!.title,"Search ownword");
   assert.equal(new Set(ranked.map(hit=>`${hit.type}:${hit.href}:${hit.title}`)).size,ranked.length);
   await env.query("drop table video_lessons cascade");
   const partial=await searchContent("Search",me!.id,env.db);
   assert.equal(partial.failedCategories,1,"a failed category is reported instead of silently returning an empty success");
   assert.ok(partial.results.some(hit=>hit.title==="Search ownword"),"working categories remain usable");
 }finally{await env.close();}
});
