import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/app" });
for (const key of ["window","document","navigator","HTMLElement","Element"] as const) {
  Object.defineProperty(globalThis,key,{ value: dom.window[key], configurable: true });
}
Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React=await import("react"); Object.assign(globalThis,{ React });
const { act }=React;
const { createRoot }=await import("react-dom/client");
const { CampusWorld }=await import("../../src/components/campus/CampusWorld");

test("WebGL fallback includes Management only while server-granted staff visibility is present", async () => {
  const root=createRoot(document.querySelector("#root")!);
  const previousError=console.error;
  console.error=()=>{}; // Native scene loading is deliberately unavailable in jsdom.
  try {
    for (const visible of [false,true,false]) {
      await act(async()=>{
        root.render(<CampusWorld showManagement={visible} managementLabel="Boshqaruv" />);
        await new Promise(resolve=>setTimeout(resolve,30));
      });
      const link=document.querySelector('a[href="/app/management"]');
      assert.equal(Boolean(link),visible);
      if (link) assert.equal(link.textContent,"Boshqaruv");
      assert.equal(document.querySelectorAll("nav a").length,visible?13:12);
    }
  } finally {
    await act(async()=>root.unmount()); console.error=previousError;
  }
});
