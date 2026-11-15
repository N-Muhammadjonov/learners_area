import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM, VirtualConsole} from 'jsdom';

const root = new URL('../../../', import.meta.url);

for (const number of [8, 10]) {
  test(`Listening Test ${number} resumes its saved attempt and reports Script Completion work`, () => {
    const slug = `test-${String(number).padStart(2, '0')}`;
    const path = new URL(`services/backend/assets/listening/${slug}.json`, root);
    const runtime = JSON.parse(readFileSync(path, 'utf8'));
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM(runtime.files[runtime.entryPath], {
      url: 'https://fixture.invalid/',
      runScripts: 'dangerously',
      virtualConsole,
      beforeParse(window) {
        window.HTMLMediaElement.prototype.play = async function () {};
        window.HTMLMediaElement.prototype.pause = function () {};
        window.HTMLMediaElement.prototype.load = function () {};
        window.scrollTo = function () {};
      },
    });
    try {
      const {window} = dom;
      const {document, localStorage} = window;
      const key = `la_listening_test_${number}_v2`;
      const previous = {
        attemptStatus: 'in_progress',
        attemptKey: 'f4bb0b74-ae85-4af4-b67e-f4fa794f94bb',
        answers: {'1': 'resume fixture'},
        flags: [1],
        audioPosition: 60,
      };
      const read = () => JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(previous));
      window.laHydrateOriginal();
      window.openActivity('exam');
      document.getElementById('startTestBtn').click();

      const resumed = read();
      assert.equal(resumed.attemptKey, previous.attemptKey);
      assert.deepEqual(resumed.answers, previous.answers);
      assert.deepEqual(resumed.flags, previous.flags);
      assert.equal(resumed.audioPosition, previous.audioPosition);

      document.getElementById('submitTest').click();
      const confirm = document.getElementById('laConfirm');
      assert(confirm, 'the opaque frame presents its own confirmation');
      confirm.click();
      assert.equal(read().attemptStatus, 'submitted');

      const work = [];
      window.laCourseWork = (activity, answers) => work.push({activity, answers: {...answers}});
      window.openActivity('script');
      assert.equal(document.querySelectorAll('[data-spart]').length, 4);
      document.querySelector('[data-spart="2"]').click();
      const gap = document.querySelector('[data-gap]');
      gap.value = 'fixture answer';
      document.querySelector('#checkScriptPart').click();
      assert.deepEqual(work, [{activity: 'script', answers: {[`2:${gap.dataset.gap}`]: 'fixture answer'}}]);
      assert.deepEqual(errors, []);
    } finally {
      dom.window.close();
    }
  });
}
