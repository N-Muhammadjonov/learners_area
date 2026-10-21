import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { generalReadingBundle } from "../src/lib/reading/import-schema";
import { importGeneralReadingSet } from "../src/lib/services/reading/general-import";
import { generalProgress, restoredGeneralCheck, saveGeneralProgress } from "../src/lib/data/general-reading";
import { getPassageWithQuestions } from "../src/lib/data/reading";

test("R-V4-18 General checked detail reload is read-only, owned, gated by persisted Check and cleared by an edit", async () => {
  const env = await createTestDatabase();
  try {
    const [a,b] = await env.query<{id:string}>("insert into users(name) values ('A'),('B') returning id");
    const bundle = generalReadingBundle.parse({sourceRef:'qa-general-review',title:'QA learning set',publish:true,passages:[{
      passageNo:1,title:'QA passage',body:'The bank approved the loan.',questions:[{
        questionNo:1,type:'short_answer',text:'What was approved?',answer:'loan',accepted:['the loan'],evidence:'The bank approved the loan.',explanation:'',
      }],
    }]});
    const imported = await env.db.transaction(tx => importGeneralReadingSet(tx,bundle));
    const passageId = imported.passages[0]!.passageId;
    const material = (await getPassageWithQuestions(passageId,env.db))!;
    const answers = {[material.questions[0]!.id]:'the loan'};
    const input = {userId:a!.id,role:'student' as const,passageId,answers,check:false};
    await saveGeneralProgress(input,env.db);
    const [draft] = await generalProgress(a!.id,imported.setId,env.db);
    assert.equal(restoredGeneralCheck(draft,material.questions,material.groups),null,'autosave never unlocks a key');
    const checked = await saveGeneralProgress({...input,check:true},env.db);
    const [saved] = await generalProgress(a!.id,imported.setId,env.db);
    const review = restoredGeneralCheck(saved,material.questions,material.groups);
    assert.deepEqual(review,checked!.result,'reload restores the actual Check projection');
    assert.equal(review![0]!.isCorrect,true);
    assert.deepEqual(review![0]!.acceptedAnswers,['the loan']);
    assert.match(review![0]!.explanation!,/quoted section.*loan/i,'source-supported feedback survives a read-only reload');
    assert.deepEqual(await generalProgress(a!.id,imported.setId,env.db),[saved],'reading review does not update progress');
    const [foreign] = await generalProgress(b!.id,imported.setId,env.db);
    assert.equal(foreign,undefined);
    assert.equal(restoredGeneralCheck(foreign,material.questions,material.groups),null);
    assert.equal(restoredGeneralCheck(saved,[],[]),null,'a mismatched source cannot restore a result');
    await saveGeneralProgress({...input,answers:{[material.questions[0]!.id]:'wrong'}},env.db);
    const [edited] = await generalProgress(a!.id,imported.setId,env.db);
    assert.equal(edited!.checkedAt,null);
    assert.equal(restoredGeneralCheck(edited,material.questions,material.groups),null,'reload after an edit needs a fresh explicit Check');
  } finally { await env.close(); }
});
