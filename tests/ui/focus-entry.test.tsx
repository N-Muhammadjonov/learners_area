import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../src/lib/i18n/en";

/**
 * Focus auto-entry, exercised as a browser would.
 *
 * The owner requirement has three halves that must all hold at once: a real
 * Reading/Listening attempt turns Focus on by itself, a manual exit is respected
 * (no loop), and ordinary browsing never auto-enables it. This test drives the
 * real shell component in JSDOM with the real attempt hook, and moves the
 * address the way a client-side navigation does — the announcement carries the
 * path it came from, so a test that only changed a React context would not be
 * testing the same thing.
 */

const ROOT = new URL("../..", import.meta.url).pathname;
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/reading/attempts/attempt-1",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react");
// The imported components are compiled with the classic JSX runtime.
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { ShellUtilities } = await import("../../src/components/shell/ShellUtilities");
const { useFocusEntry, clearFocusEntry } = await import("../../src/lib/interaction/focus-entry");

const q = <T extends Element = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  assert.ok(element, selector);
  return element;
};
const focusState = () => document.documentElement.dataset.focus;
const stored = () => window.localStorage.getItem("la_focus");
const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch: async () => {} };

function Attempt({ attemptId }: { attemptId: string }) {
  useFocusEntry(attemptId);
  return null;
}

function Screen({ pathname, attemptId }: { pathname: string; attemptId?: string }) {
  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={pathname}>
        <ShellUtilities dict={en} />
        {attemptId ? <Attempt attemptId={attemptId} /> : null}
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

test("a real attempt enters Focus once, a manual exit survives a remount, a new attempt focuses again, browsing never does", async () => {
  clearFocusEntry();
  window.localStorage.clear();
  const root = createRoot(q("#root"));
  const render = async (pathname: string, attemptId?: string) => {
    // A client-side navigation moves the address bar too.
    window.history.pushState(null, "", pathname);
    await act(async () => root.render(<Screen pathname={pathname} attemptId={attemptId} />));
  };
  try {
    // 1. A Reading attempt opens: Focus turns on without any interaction, and the
    //    learner's stored preference is not rewritten by the automatic entry.
    await render("/reading/attempts/attempt-1", "attempt-1");
    assert.equal(focusState(), "on");
    // The utility stack is collapsed until asked for; one press reveals it.
    assert.equal(q("[data-utilities-launcher]").getAttribute("aria-expanded"), "false");
    assert.equal(document.querySelector("[data-focus-toggle]"), null);
    await act(async () => q<HTMLElement>("[data-utilities-launcher]").click());
    assert.equal(q("[data-utilities-launcher]").getAttribute("aria-expanded"), "true");
    assert.equal(q("[data-focus-toggle]").getAttribute("aria-pressed"), "true");
    assert.equal(stored(), null, "an automatic entry is not a stored preference");

    // 2. The learner leaves Focus for this attempt: that decision is remembered,
    //    and the same attempt cannot force Focus back on — even if its screen
    //    mounts again (a client-side remount, a re-entry from history).
    await act(async () => q<HTMLElement>("[data-focus-toggle]").click());
    assert.equal(focusState(), "off");
    assert.equal(stored(), "off", "a manual choice is still remembered");
    await render("/reading/attempts/attempt-1");
    await render("/reading/attempts/attempt-1", "attempt-1");
    assert.equal(focusState(), "off", "no re-enable loop for the attempt the learner exited");

    // 3. A different attempt is a new decision point and focuses itself.
    await render("/reading/attempts/attempt-2", "attempt-2");
    assert.equal(focusState(), "on");

    // 4. Ordinary Reading browsing never auto-enables it.
    await render("/reading");
    assert.equal(focusState(), "off");
    await render("/reading/retention");
    assert.equal(focusState(), "off");

    // 5. A Listening attempt behaves exactly like a Reading one.
    await render("/listening/attempts/attempt-3", "attempt-3");
    assert.equal(focusState(), "on");
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
  }
});

test("test and General Reading entry screens can auto-enter Focus", () => {
  const callers = ["src/components/reading/ReadingExam.tsx", "src/components/listening/ListeningExam.tsx"];
  for (const file of callers) {
    assert.match(readFileSync(join(ROOT, file), "utf8"), /useFocusEntry\(attemptId\)/, file);
  }
  // The announcer is a hook, so anything that imported it would be a new auto-on
  // path; the exam components are the complete set.
  const consumers = execSync("grep -rl '@/lib/interaction/focus-entry' src --include=*.tsx --include=*.ts", { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  assert.deepEqual(consumers, [
    "src/components/interaction/TestFocusEntry.tsx",
    "src/components/listening/ListeningExam.tsx",
    "src/components/reading/GeneralReadingSession.tsx",
    "src/components/reading/ReadingExam.tsx",
    "src/components/shell/ShellUtilities.tsx",
  ]);
});
