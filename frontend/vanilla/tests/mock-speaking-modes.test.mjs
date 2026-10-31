import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const ui = fs.readFileSync(path.join(root,'modules/staff-final30/mock-create.js'),'utf8');
test('Manual single question set and per-student auto mode both exist',()=>{
  assert.match(ui,/data-mock-speaking-mode/);
  assert.match(ui,/value:'fixed'/);
  assert.match(ui,/value:'auto'/);
  assert.match(ui,/data-mock-speaking-auto-hint/);
  assert.match(ui,/speakingMode:state\.speakingMode/);
});
test('Mode switch resets old speaking content version and restores draft mode',()=>{
  assert.match(ui,/speakingMode\.value;state\.sections\.speaking=''/);
  assert.match(ui,/speakingMode:test\.speakingMode\|\|'fixed'/);
  assert.match(ui,/state\.speakingMode==='auto'/);
});
