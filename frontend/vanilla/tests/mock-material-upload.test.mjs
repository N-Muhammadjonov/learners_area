import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('Listening/Reading/Writing options use dedicated Mock uploads, not practice or MCQ',()=>{
 const ui=read('modules/staff-final30/mock-create.js');
 assert.match(ui,/v\.module==='mock'/);
 assert.doesNotMatch(ui,/v\.module===module/);
 assert.match(ui,/data-mock-material-json/);
 assert.match(ui,/data-mock-material-media/);
 assert.match(ui,/FormData/);
 assert.match(ui,/api\/staff\/mocks\/materials/);
});
test('Speaking selections are resolved per Part 1,2,3 from existing bank',()=>{
 const ui=read('modules/staff-final30/mock-create.js');
 assert.match(ui,/speakingTopics/);
 assert.match(ui,/data-mock-speaking-topic/);
 assert.match(ui,/\['P1','P2','P3'\]/);
 assert.match(ui,/state\.sections\.speaking=''/);
});
test('No fabricated Mock content or direct practice bank linkage',()=>{
 const ui=read('modules/staff-final30/mock-create.js');
 assert.doesNotMatch(ui,/Array\.from\(\{length:\s*40/);
 assert.doesNotMatch(ui,/listening\/mcq|reading\/general/);
});
