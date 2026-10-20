import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDraft} from '../src/lib/dictionary/model';
import {addCorpusInflections} from '../scripts/dictionary/morphology';
test('attested regular forms preserve canonical POS/IDs and never guess a contextual sense',()=>{
 const release='rel-v1-555555555555555555555555',spec=[['question','n'],['study','v'],['stop','v'],['large','a'],['happy','a'],['specie','n'],['species','n'],['her','pronoun'],['he','n']] as const;
 const entries=spec.map(([lemma,pos])=>applyDraft([],{operation:'add_lexeme',lemma,partOfSpeech:pos,lexicalType:'word',definitionEn:'Fixture '+lemma,translationUz:'Sinov',definitionUz:'Sinov',examples:[]},release)),ids=entries.map(e=>[e.lexeme_id,e.senses[0]!.sense_id]);
 const result=addCorpusInflections(entries,[{body:'questions studied stopped larger happiest species hers'}]);
 for(const [lemma,form] of [['question','questions'],['study','studied'],['stop','stopped'],['large','larger'],['happy','happiest']])assert.ok(entries.find(e=>e.display_lemma===lemma)!.forms.some(f=>f.surface_form===form));
 assert.ok(!entries.find(e=>e.display_lemma==='specie')!.forms.some(f=>f.surface_form==='species'));assert.equal(result.contextSensesAssigned,0);assert.deepEqual(entries.map(e=>[e.lexeme_id,e.senses[0]!.sense_id]),ids);assert.equal(addCorpusInflections(entries,[{body:'questions studied stopped larger happiest species hers'}]).addedForms,0);
});
