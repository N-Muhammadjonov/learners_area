import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleWords,gapPrompt} from '../modules/vocabulary/game-content.js';
import {acceptsAnswer} from '../modules/vocabulary/game-common.js';

test('synonym variants and articles preserve environment game eligibility',()=>{
 const words=[
  {id:'one',term:'chilly / nippy',definitionEn:'Noticeably cold.',exampleSentence:'It felt chilly by the coast.',translationUz:'salqinroq',acceptedTranslations:['chilly','nippy']},
  {id:'two',term:'it’s pouring / it’s chucking it down',definitionEn:'It is raining heavily.',exampleSentence:'Take an umbrella: it’s pouring.',translationUz:'jala quyayapti',acceptedTranslations:['it’s pouring','it’s chucking it down']},
  {id:'three',term:'a hail of abuse / a storm of abuse',definitionEn:'A sudden outpouring of insulting language.',exampleSentence:'The official faced a storm of abuse.',translationUz:'haqoratlar yog‘ilishi',acceptedTranslations:['a hail of abuse','a storm of abuse']},
  {id:'four',term:'a sunny disposition',definitionEn:'A cheerful temperament.',exampleSentence:'Her sunny disposition made everyone welcome.',translationUz:'xushchaqchaq fe’l-atvor'}
 ];
 assert.equal(gapPrompt(words[0]),'It felt ______ by the coast.');
 assert.equal(gapPrompt(words[1]),'Take an umbrella: ______.');
 assert.equal(gapPrompt(words[2]),'The official faced ______.');
 assert.equal(gapPrompt(words[3]),'Her ______ made everyone welcome.');
 assert.equal(eligibleWords(words,'gap').length,4);
 assert.equal(eligibleWords(words,'translation').length,4);
 assert(acceptsAnswer(words[0],'nippy'));
 assert(acceptsAnswer(words[1],"it's pouring"));
});
