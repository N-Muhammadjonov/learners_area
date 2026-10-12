import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import en from '../../src/lib/i18n/en';
import {ReadingEvidence} from '../../src/components/reading/ReadingEvidence';
Object.assign(globalThis,{React});
test('authored evidence locates the exact quote in its own source without lexical targets',()=>{
 const doc=new JSDOM(renderToStaticMarkup(<ReadingEvidence dict={en} body="Before. The bank approved the loan. After." title="Passage two" quote="The bank approved the loan."/>)).window.document;
 assert.equal(doc.querySelector('mark')?.textContent,'The bank approved the loan.');
 assert.ok(doc.querySelector('summary')?.textContent?.includes('Passage two'));
 assert.equal(doc.querySelector('[data-clickable-text]'),null);
});
test('evidence absent from the question source is reported missing, never borrowed from another passage',()=>{
 const doc=new JSDOM(renderToStaticMarkup(<ReadingEvidence dict={en} body="An unrelated passage." title="Passage three" quote="The bank approved the loan."/>)).window.document;
 assert.ok(doc.querySelector('[data-reading-evidence-unlocated]'));
 assert.equal(doc.querySelector('mark'),null);
});
