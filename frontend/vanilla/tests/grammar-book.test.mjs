
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookIndex} from '../modules/grammar/book-index.js';

test('interactive grammar book has 80 units grouped into four visible CEFR sections', () => {
  assert.equal(bookIndex.length, 80);
  assert.equal(new Set(bookIndex.map(u => u.id)).size, 80);
  const counts = {B1: 0, B2: 0, C1: 0, C2: 0};
  for (const unit of bookIndex) {
    const level = ['A0', 'A1', 'A2', 'B1'].includes(unit.code) ? 'B1' : unit.code;
    assert.ok(level in counts);
    counts[level]++;
    assert.equal(unit.stageWeights.length, 4);
    assert.deepEqual(unit.stageWeights.map(s => s.length), [3, 3, 3, 3]);
  }
  assert.deepEqual(counts, {B1: 46, B2: 13, C1: 11, C2: 10});
});

test('interactive book data retains all original questions, unit titles and stages', async () => {
  const all = [];
  for (const level of ['b1', 'b2', 'c1', 'c2']) {
    const result = await import('../modules/grammar/book-content-' + level + '.js');
    all.push(...result.default);
  }
  assert.equal(all.length, 80);
  assert.equal(all.reduce((n, u) => n + u.stages.reduce((sum, s) => sum + s.ex.length, 0), 0), 960);
  for (const u of all) {
    const meta = bookIndex.find(x => x.id === u.id);
    assert.ok(meta);
    assert.equal(meta.title, u.title);
    assert.equal(meta.code, u.code);
    assert.equal(u.stages.length, 4);
    assert.deepEqual(meta.stageWeights, u.stages.map(s => s.ex.map(e => e.kind === 'write' ? 1 : e.items.length)));
    assert.ok(u.rule.title);
  }
});
