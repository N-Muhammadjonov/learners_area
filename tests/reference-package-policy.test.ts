import test from "node:test";
import assert from "node:assert/strict";
import { eligibleIntentTarget, IntentPrefetchBudget } from "../src/lib/interaction/intent-prefetch";
import { decodeMeasurementDraft } from "../src/lib/retention/measurement-draft";
import { measurementStructureSchema } from "../src/lib/retention/measurement";
test("intent policy rejects external, attempts, admin, answers and query strings", () => {
 for (const raw of ["https://evil.test/dashboard", "/app/admin/reading/retention", "/app/reading/retention/results/a", "/app/reading?attempt=a", "/reading#answers", "/app"]) assert.equal(eligibleIntentTarget(raw,"https://learn.test","/app"), null);
 assert.equal(eligibleIntentTarget("/app/reading","https://learn.test","/app"), null, "redirect-only doorway must not be prefetched");
 assert.equal(eligibleIntentTarget("/app/reading/lessons","https://learn.test","/app"), "/app/reading/lessons");
});
test("budget deduplicates, spaces dispatches and resets only after its window", () => {
 const b=new IntentPrefetchBudget(); assert.equal(b.take("/app/reading",1000),true); assert.equal(b.take("/app/reading",2000),false); assert.equal(b.take("/app/writing",1100),false);
 for(let i=0;i<5;i++) assert.equal(b.take(`/route${i}`,2000+i*1000),true);
 assert.equal(b.take("/seventh",8000),false); assert.equal(b.take("/app/reading",62000),true);
});
test("draft editor preserves IDs, phrases, critical flags and server validation", () => {
 const s={schemaVersion:1,maxScore:100,claims:[{id:"c1",label:"Founded in 2020",points:100,scope:"sentence",groups:[{id:"g1",points:100,kind:"date",anyOf:["2020"],critical:true}],acceptedPhrases:["founded in 2020"],rejectPhrases:["not founded in 2020"]}]};
 const parsed=decodeMeasurementDraft(JSON.stringify(s));assert.deepEqual(parsed,s);assert.equal(measurementStructureSchema.safeParse(parsed).success,true);
 const changed=structuredClone(s);changed.claims[0]!.groups[0]!.points=99;
 assert.ok(decodeMeasurementDraft(JSON.stringify(changed)));assert.equal(measurementStructureSchema.safeParse(changed).success,false);
});
test("unknown fields and malformed data are preserved in raw mode, never silently stripped", () => {
 assert.equal(decodeMeasurementDraft('{"schemaVersion":2,"maxScore":100,"claims":[]}'),null);
 assert.equal(decodeMeasurementDraft('{"schemaVersion":1,"maxScore":100,"claims":[],"script":"evil"}'),null);
 assert.equal(decodeMeasurementDraft('not json'),null);
 assert.deepEqual(decodeMeasurementDraft(''),{schemaVersion:1,maxScore:100,claims:[]});
});
