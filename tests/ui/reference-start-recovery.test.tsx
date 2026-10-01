import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/reading/retention" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { RetentionSession } = await import("../../src/components/reading/RetentionSession");

const query = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, `expected ${selector}`);
  return found;
};
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
async function render(element: React.ReactNode, run: (refreshes: { count: number }) => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(query<HTMLDivElement>("#root"));
  const refreshes = { count: 0 };
  const router = { back() {}, forward() {}, refresh() { refreshes.count += 1; }, push() {}, replace() {}, prefetch() {} };
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, element)));
    await run(refreshes);
  } finally {
    await act(async () => root.unmount());
  }
}


test("start is one synchronous flight and is cancelled on leave", async () => {
 const old=globalThis.fetch;let calls=0;let signal:AbortSignal | undefined;
 globalThis.fetch=(async (_url,init)=> { calls++;signal=init?.signal as AbortSignal; return await new Promise<Response>((_resolve,reject)=>signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true})); }) as typeof fetch;
 try { await render(React.createElement(RetentionSession,{dict:en,initial:null}),async()=>{
  await act(async()=> {query<HTMLButtonElement>("[data-retention-start]").click();query<HTMLButtonElement>("[data-retention-start]").click();});
  assert.equal(calls,1);assert.equal(signal?.aborted,false);
 });assert.equal(signal?.aborted,true); } finally {globalThis.fetch=old;}
});
test("start deadline stops the spinner and requires an authoritative read before another write", async () => {
 const old=globalThis.fetch;const timeout=window.setTimeout;let calls=0;
 window.setTimeout=((handler:TimerHandler,ms?:number,...args:unknown[])=>timeout(handler,ms===12000?15:ms,...args)) as typeof window.setTimeout;
 globalThis.fetch=(async (_url,init)=> { calls++;const signal=init?.signal;return await new Promise<Response>((_resolve,reject)=>signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true})); }) as typeof fetch;
 try { await render(React.createElement(RetentionSession,{dict:en,initial:null}),async()=>{
  await act(async()=>query<HTMLButtonElement>("[data-retention-start]").click());await wait(40);
  assert.equal(query<HTMLButtonElement>("[data-retention-start]").disabled,true);
  assert.match(query("[data-retention-error]").textContent ?? "",/already have started/);
  assert.ok(query("[data-retention-recover-start]"));assert.equal(calls,1);
 }); } finally {globalThis.fetch=old;window.setTimeout=timeout;}
});
