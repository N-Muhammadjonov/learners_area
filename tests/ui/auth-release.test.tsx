import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/login" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Event", "MouseEvent"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { LoginForm } = await import("../../src/components/auth/LoginForm");
const { RegisterForm } = await import("../../src/components/auth/RegisterForm");
const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch: async () => {} };
async function mount(el: React.ReactNode, check: () => Promise<void> | void) {
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<AppRouterContext.Provider value={router}><SearchParamsContext.Provider value={new URLSearchParams()}>{el}</SearchParamsContext.Provider></AppRouterContext.Provider>));
    await check();
  } finally { await act(async () => root.unmount()); }
}
for (const dict of [en, uz]) {
  test(`${dict.auth.loginCta}: Telegram-only login and registration expose no password/google/reset forms`, async () => {
    for (const Component of [LoginForm, RegisterForm]) await mount(
      <Component dict={dict} passwordEnabled={false} telegramConfigured telegramBotUsername="fixture_bot" nonce="qa-nonce" />,
      () => {
        assert.equal(document.querySelector("input[type='password'],input[type='email'],form,a[href*='google'],a[href*='reset']"), null);
        if (Component === RegisterForm) {
          assert.equal(document.querySelectorAll("input[autocomplete='given-name'],input[autocomplete='family-name']").length, 2);
        } else assert.equal(document.querySelector("input"), null);
        const widget = document.querySelector("script[data-telegram-login]")!;
        assert.ok(widget);
        assert.equal(widget.getAttribute("nonce"), "qa-nonce");
        assert.equal(widget.getAttribute("data-auth-url"), "/api/auth/telegram/callback");
      });
  });
  test(`${dict.auth.loginCta}: rollback preserves fields; recovery uses separate endpoint without provider/reset links`, async () => {
    await mount(<LoginForm dict={dict} telegramConfigured={false} googleConfigured />, () => {
      assert.ok(document.querySelector("input[type='password']"));
      assert.ok(document.querySelector("a[href*='google']"));
      assert.ok(document.querySelector("a[href*='reset']"));
    });
    const original = globalThis.fetch;
    let endpoint = "";
    globalThis.fetch = async (url) => { endpoint = String(url); return Response.json({ error: "invalid_credentials" }, { status: 401 }); };
    try {
      await mount(<LoginForm dict={dict} recovery telegramConfigured={false} />, async () => {
        assert.ok(document.querySelector("input[type='password']"));
        assert.equal(document.querySelector("a,script[data-telegram-login]"), null);
        await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        assert.equal(endpoint, "/api/auth/recovery/login");
      });
    } finally { globalThis.fetch = original; }
  });
}
