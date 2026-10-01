import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/vocabulary?tab=use" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react"); Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { VocabUsePanel } = await import("../../src/components/vocabulary/VocabUsePanel");
const { NewVideoLessonForm } = await import("../../src/components/admin/NewVideoLessonForm");
const { VideoLessonStudio } = await import("../../src/components/courses/VideoLessonStudio");
const q = <T extends Element = HTMLElement>(selector: string) => { const el = document.querySelector<T>(selector); assert.ok(el, selector); return el; };
const tick = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const json = (body: unknown, status = 200) => Response.json(body, { status });
const words = (folder: string, count = 2) => Array.from({ length: count }, (_, index) => ({ id: `${folder}-${index}`, term: `${folder} word ${index}`, definitionEn: "meaning", translationUz: null, mastery: "new", folderId: folder }));
async function mounted(element: React.ReactNode, run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(q('#root'));
  try { await act(async () => root.render(<AppRouterContext.Provider value={{ push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch() {} }}>{element}</AppRouterContext.Provider>)); await run(); }
  finally { await act(async () => root.unmount()); }
}
async function choose(selector: string, value: string) { await act(async () => { const el = q<HTMLSelectElement>(selector); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function draft(value: string) { await act(async () => { const el = q<HTMLTextAreaElement>('[data-sentence-input]'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function withFetch(run: () => Promise<void>, submit: (url: string) => Response = () => json({ ok: true, accepted: true, points: 2 })) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') return submit(url);
    if (url.endsWith('/folders')) return json({ ok: true, folders: [{ id: 'A', name: 'File A', count: 2 }, { id: 'B', name: 'File B', count: 2 }] });
    if (url.includes('view=history')) return json({ ok: true, sentences: [] });
    const params = new URL(url,'http://localhost').searchParams;
    return json({ ok: true, words: words(params.get('folderId') || 'all'), hasMore: false });
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; }
}
for (const accepted of [true, false]) test(`Use folder-only check advances within its file (accepted: ${accepted})`, async () => {
  const submitted: string[] = [];
  await withFetch(async () => mounted(<VocabUsePanel dict={en} onSaved={() => {}} />, async () => {
    await tick(); await choose('[data-sentence-folder]','A'); await tick();
    assert.equal(q<HTMLSelectElement>('[data-sentence-word]').value, '');
    const before = q('[data-sentence-current]').getAttribute('data-sentence-current')!;
    assert.match(before, /^A-/);
    await draft('A natural sentence for this word.');
    await act(async () => q<HTMLButtonElement>('[data-sentence-submit]').click());
    assert.ok(q('[data-sentence-message]'));
    await tick(1450);
    const after = q('[data-sentence-current]').getAttribute('data-sentence-current')!;
    assert.match(after, /^A-/); assert.notEqual(before, after);
    assert.ok(submitted[0]?.includes(`/api/vocabulary/${before}/use`));
    assert.equal(q<HTMLTextAreaElement>('[data-sentence-input]').value,'');
  }), (url) => { submitted.push(url); return json({ ok: true, accepted, points: accepted ? 2 : 0 }); });
});
test('Use an explicit word remains selected after checking; evaluator failure keeps draft', async () => {
  await withFetch(async () => mounted(<VocabUsePanel dict={en} onSaved={() => {}} />, async () => {
    await tick(); await choose('[data-sentence-folder]','B'); await tick(); await choose('[data-sentence-word]','B-0');
    await draft('Keep this sentence when the evaluator fails.'); await act(async () => q<HTMLButtonElement>('[data-sentence-submit]').click()); await tick(1450);
    assert.equal(q('[data-sentence-current]').getAttribute('data-sentence-current'),'B-0');
    assert.equal(q<HTMLTextAreaElement>('[data-sentence-input]').value,'Keep this sentence when the evaluator fails.');
    assert.equal(q('[data-sentence-message]').getAttribute('data-sentence-message'),'bad');
  }), () => json({ ok: false },503));
});
test('Use changing the file clears an old draft and cannot carry words into another file', async () => {
  await withFetch(async () => mounted(<VocabUsePanel dict={en} onSaved={() => {}} />, async () => {
    await tick(); await choose('[data-sentence-folder]','A'); await tick(); await draft('A file draft.');
    await choose('[data-sentence-folder]','B'); await tick();
    assert.equal(q<HTMLTextAreaElement>('[data-sentence-input]').value,'');
    assert.match(q('[data-sentence-current]').getAttribute('data-sentence-current')!, /^B-/);
    assert.ok([...q<HTMLSelectElement>('[data-sentence-word]').options].every(option => !option.value || option.value.startsWith('B-')));
  }));
});
test('Use word pages are concatenated before shuffling, including the 101st entry', async () => {
  const original=globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url=String(input); if(url.endsWith('/folders')) return json({ok:true,folders:[]});
    if(url.includes('view=history')) return json({ok:true,sentences:[]});
    const offset=Number(new URL(url,'http://localhost').searchParams.get('offset'));
    return json({ok:true,words:offset===0?words('A',100):[{...words('A',1)[0],id:'A-100'}],hasMore:offset===0});
  }) as typeof fetch;
  try { await mounted(<VocabUsePanel dict={en} onSaved={() => {}} />,async()=>{await tick(); assert.equal(q<HTMLSelectElement>('[data-sentence-word]').options.length,102);}); } finally{globalThis.fetch=original;}
});
test('Video authoring presents URL, title and notes without a transcript input', async () => {
  await mounted(<NewVideoLessonForm dict={en} lessons={[]} />, async () => {
    const labels=[...document.querySelectorAll('form > label')].map(el=>el.textContent ?? '');
    assert.ok(labels[0]?.includes(en.videoLessonAdmin.videoUrl));
    assert.ok(labels[1]?.includes(en.videoLessonAdmin.videoTitle));
    assert.ok(labels[2]?.includes(en.videoLessonAdmin.notes));
    assert.equal(document.querySelector('[data-video-transcript-input]'),null);
  });
});
test('Player keeps native controls and CC, forbids popups/top navigation and has no below-player transcript control', async () => {
  await mounted(<VideoLessonStudio dict={en} lessonId="local" videoLesson={{id:'local',provider:'youtube',videoId:'dQw4w9WgXcQ',title:'QA video',beforeYouWatch:null,durationSeconds:null,transcript:[{startSeconds:0,text:'Old authored transcript'}],transcriptSource:'authored',transcriptAttribution:null,transcriptText:'Legacy text',notes:null}} questions={[]} initialProgress={null} />, async () => {
    const frame=q<HTMLIFrameElement>('[data-video-frame]');
    assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-presentation');
    const src=new URL(frame.src);assert.equal(src.origin,'https://www.youtube-nocookie.com');assert.equal(src.searchParams.get('controls'),'1');assert.equal(src.searchParams.get('cc_load_policy'),'1');
    assert.equal(document.querySelector('[data-video-transcript-reveal]'),null);
    assert.equal(document.querySelector('a[href*="youtube.com"]'),null);
  });
});
test('Video network failure releases save and keeps the learner draft for a manual retry', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new TypeError('offline'); }) as typeof fetch;
  try {
    await mounted(<VideoLessonStudio dict={en} lessonId="local" videoLesson={{id:'local',provider:'youtube',videoId:'dQw4w9WgXcQ',title:'QA video',beforeYouWatch:null,durationSeconds:null,transcript:null,transcriptSource:null,transcriptAttribution:null,notes:null}} questions={[]} initialProgress={null} />, async () => {
      await act(async () => {
        const input=q<HTMLTextAreaElement>('[data-video-opinion-input]');
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'My retained draft.');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await act(async () => q<HTMLButtonElement>('[data-video-save-response]').click());
      assert.equal(calls,1);
      assert.equal(q<HTMLButtonElement>('[data-video-save-response]').disabled,false);
      assert.equal(q<HTMLTextAreaElement>('[data-video-opinion-input]').value,'My retained draft.');
      assert.ok(q('[data-video-request-error]'));
      await act(async () => q<HTMLButtonElement>('[data-video-save-response]').click());
      assert.equal(calls,2);
    });
  } finally { globalThis.fetch=original; }
});
test('Slow video progress survives subsequent player ticks and aborts only when leaving', async () => {
  const original=globalThis.fetch;
  let signal: AbortSignal | undefined;
  let calls=0;
  globalThis.fetch=(async (_input,init)=>{calls++;signal=init?.signal ?? undefined;return new Promise<Response>((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}) as typeof fetch;
  try {
    await mounted(<VideoLessonStudio dict={en} lessonId="local" videoLesson={{id:'local',provider:'youtube',videoId:'iG9CE55wbtY',title:'QA video',beforeYouWatch:null,durationSeconds:null,transcript:null,transcriptSource:null,transcriptAttribution:null,notes:null}} questions={[]} initialProgress={null} />,async()=>{
      const frame=q<HTMLIFrameElement>('[data-video-frame]');
      for(const currentTime of [6,7,12]) await act(async()=>window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'https://www.youtube-nocookie.com',data:{info:{currentTime}}})));
      assert.equal(calls,1);assert.equal(signal?.aborted,false);
    });
    assert.equal(signal?.aborted,true);
  }finally{globalThis.fetch=original;}
});

test('TED end screen rejects forged messages and replaces the genuine completed frame with Replay', async () => {
  await mounted(<VideoLessonStudio dict={en} lessonId="local" videoLesson={{id:'local',provider:'youtube',videoId:'iG9CE55wbtY',title:'QA video',beforeYouWatch:null,durationSeconds:null,transcript:null,transcriptSource:null,transcriptAttribution:null,notes:null}} questions={[]} initialProgress={null} />, async () => {
    const frame=q<HTMLIFrameElement>('[data-video-frame]');
    await act(async()=>window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'https://untrusted.example',data:{event:'onStateChange',info:0}})));
    assert.ok(document.querySelector('[data-video-frame]'));
    await act(async()=>window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'https://www.youtube-nocookie.com',data:{event:'onStateChange',info:0}})));
    assert.equal(document.querySelector('[data-video-frame]'),null);
    assert.ok(document.querySelector('[data-video-ended]'));
    await act(async()=>q<HTMLButtonElement>('[data-video-ended] button').click());
    assert.ok(document.querySelector('[data-video-frame]'));
  });
});
