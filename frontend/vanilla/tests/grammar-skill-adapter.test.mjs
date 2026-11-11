import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptSkillUnit} from '../modules/grammar/book-skill-adapter.js';

test('grammar skill adapter loads localized stages and preserves the Qo‘llash instructions', () => {
  const titles = ['Tushunish', 'Mustahkamlash', 'Qo‘llash', 'Erkin qo‘llash'];
  const raw = {
    id: 'skill-regression',
    group: 'A0',
    title: 'Grammar regression',
    number: 1,
    formula: 'Subject + verb',
    specific_rule: 'Apply the sentence pattern.',
    simple_explanation: 'Build a sentence.',
    stages: titles.map(title => ({
      title,
      groups: ['A', 'B', 'C'].map(label => ({
        label,
        type: 'mcq',
        items: [{prompt: 'Choose the correct answer.', answer: 'yes', options: ['no', 'yes']}],
      })),
    })),
  };

  const result = adaptSkillUnit(raw);
  assert.equal(result.stages.length, 4);
  assert.equal(result.stages[2].name, 'Qo‘llash');
  assert.equal(result.stages[2].sub, 'Qoidani yangi gaplarda ishlating.');
  for (const stage of result.stages) {
    assert.equal(stage.ex.length, 3);
    assert(stage.ex.every(exercise => exercise.kind === 'mcq'));
  }
});
