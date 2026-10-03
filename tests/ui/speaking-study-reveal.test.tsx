import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url:"http://localhost/speaking/practice"});
for (const key of ["window","document","navigator","HTMLElement","Element","Node","Event","KeyboardEvent"] as const) Object.defineProperty(globalThis,key,{value:(dom.window as unknown as Record<string,unknown>)[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:globalThis});
const React = await import("react"); Object.assign(globalThis,{React});
const { act } = React; const { createRoot } = await import("react-dom/client");
const { StudySupportPanel } = await import("../../src/components/speaking/StudySupportPanel");

test("support stays covered after a short hold, reveals after three seconds, and a different question starts covered", async () => {
  const root = createRoot(document.querySelector("#root")!);
  const support = {vocabularyHtml:"<b>Authored hint</b>",modelAnswerHtml:"<i>Sample</i>",ideasHtml:"Idea",vocabulary:[]};
  try {
    await act(async () => root.render(React.createElement(StudySupportPanel,{dict:en,promptId:"11111111-1111-4111-8111-111111111111",support,key:"first"})));
    const button = () => document.querySelector<HTMLButtonElement>('[data-study-support] button:not([role="tab"])')!;
    const key = (type:string) => button().dispatchEvent(new KeyboardEvent(type,{key:" ",bubbles:true,cancelable:true}));
    assert.equal(document.querySelector('[role="tabpanel"]'),null);
    await act(async () => {key("keydown");await new Promise(r=>setTimeout(r,150));key("keyup");});
    assert.equal(document.querySelector('[role="tabpanel"]'),null);
    await act(async () => {key("keydown");await new Promise(r=>setTimeout(r,3100));});
    assert.match(document.querySelector('[role="tabpanel"]')!.textContent!,/Authored hint/);
    await act(async () => root.render(React.createElement(StudySupportPanel,{dict:en,promptId:"22222222-2222-4222-8222-222222222222",support,key:"second"})));
    assert.equal(document.querySelector('[role="tabpanel"]'),null);
    await act(async () => {key("keydown");});
    await act(async () => root.unmount());
  } finally { await act(async () => root.unmount()); }
});
