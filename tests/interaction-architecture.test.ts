import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { internalNavigationTarget, routeLocation, workspaceKey } from "../src/lib/interaction/navigation";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("internal route intent preserves deep links and queries without exposing them in metric route keys", () => {
  const target = internalNavigationTarget(
    "/reading/attempts/attempt-secret?mode=review&part=2#question-9",
    "https://learners.example",
    "/reading?status=all",
  );
  assert.deepEqual(target, {
    href: "/reading/attempts/attempt-secret?mode=review&part=2",
    routeKey: "reading",
  });
  assert.equal(routeLocation("/reading", "?status=all"), "/reading?status=all");
  assert.equal(workspaceKey("/reading/attempts/private-user-id"), "reading");
});

test("route intent never intercepts external, malformed, or same-view hash-only URLs", () => {
  assert.equal(internalNavigationTarget("https://elsewhere.example/a", "https://learners.example", "/"), null);
  assert.equal(internalNavigationTarget("/reading#section", "https://learners.example", "/reading"), null);
  assert.equal(internalNavigationTarget("http://[invalid", "https://learners.example", "/"), null);
});

test("persistent private layout keeps server authorization and wraps only its workspace outlet", () => {
  const layout = read("src/app/(app)/layout.tsx");
  assert.match(layout, /getCurrentUser\(\)/);
  assert.match(layout, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(layout, /id="main-content"\s+tabIndex=\{-1\}/);
  assert.match(layout, /<InstantInteractionProvider/);
  assert.match(layout, /<InstantWorkspaceOutlet[\s\S]*?\{children\}[\s\S]*?<\/InstantWorkspaceOutlet>/);
  assert.match(layout, /<Sidebar[\s\S]*?\/\>/);
  assert.match(layout, /<Topbar[\s\S]*?\/\>/);
});

test("automatic sidebar prefetch has a data-free private loading boundary", () => {
  const links = read("src/components/interaction/InstantLink.tsx");
  const boundary = read("src/app/(app)/loading.tsx");
  const sidebar = read("src/components/shell/SidebarNav.tsx");
  assert.match(links, /prefetch=\{prefetch \?\? null\}/);
  assert.doesNotMatch(sidebar, /prefetch=\{false\}/);
  assert.match(boundary, /data-private-loading-boundary/);
  assert.doesNotMatch(boundary, /getCurrentUser|db\.|fetch\(/);
  assert.match(boundary, /aria-busy="true"/);
});

test("route outlet preserves a live shell and exposes a localized, retryable destination state", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  assert.match(provider, /usePathname\(\)/);
  assert.match(provider, /useSearchParams\(\)/);
  assert.match(provider, /onPopState/);
  assert.match(provider, /router\.push\(href\)/);
  assert.doesNotMatch(provider, /history\.pushState|history\.replaceState/);
  assert.match(outlet, /role="status"/);
  assert.match(outlet, /aria-live="polite"/);
  assert.match(outlet, /onClick=\{retryNavigation\}/);
});

test("shared async and destructive controls expose pending, duplicate-submit and confirmation contracts", () => {
  const primitives = read("src/components/interaction/InteractionPrimitives.tsx");
  assert.match(primitives, /aria-busy=\{pending \|\| undefined\}/);
  assert.match(primitives, /disabled=\{disabled \|\| pending\}/);
  assert.match(primitives, /inFlight\.current/);
  assert.match(primitives, /showModal\(\)/);
  assert.match(primitives, /role="alert"/);
  assert.match(read("src/components/shell/ProfileMenu.tsx"), /<ConfirmAction/);
});

test("diagnostics are opt-in outside production and exclude private-shell events from duplicate capture", () => {
  const root = read("src/app/layout.tsx");
  const telemetry = read("src/components/interaction/GlobalControlDiagnostics.tsx");
  assert.match(root, /performanceDiagnosticsEnabled\(\)/);
  assert.match(telemetry, /closest\("\[data-shell\]"\)/);
  assert.doesNotMatch(telemetry, /target\.value|\.href\s*[,}]/);
  assert.match(telemetry, /responseSignal: "next-animation-frame"/);
});

test("role, account-status, and admission decisions require a modal before authoritative server writes", () => {
  const people = read("src/components/admin/PeopleTable.tsx");
  const admission = read("src/components/admin/AdmissionQueue.tsx");
  const legacyRole = read("src/components/admin/RoleSelect.tsx");
  assert.match(people, /<ConfirmSelect/);
  assert.match(people, /<ConfirmAction/);
  assert.match(people, /fetch\(`\/api\/admin\/users\/\$\{person\.id\}\/role`/);
  assert.match(people, /fetch\(`\/api\/admin\/users\/\$\{person\.id\}\/status`/);
  assert.match(admission, /<ConfirmAction[\s\S]*?onConfirm=\{\(\) => decide/);
  assert.match(legacyRole, /<ConfirmSelect/);
});

test("locale preference acknowledges work before awaiting persistence and preserves an error state", () => {
  const locale = read("src/components/shell/LocaleSwitcher.tsx");
  assert.match(locale, /setRequestPending\(true\)/);
  assert.match(locale, /if \(!response\.ok\) throw/);
  assert.match(locale, /role="alert"/);
  assert.match(locale, /disabled=\{pending\}/);
});

test("global interaction styles give immediate active feedback and honor reduced motion", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /:active:not\(:disabled\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /touch-action: manipulation/);
});

test("button semantics are automatically enforced across source JSX", () => {
  const files: string[] = [];
  const visitDirectory = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(path);
      else if (path.endsWith(".tsx")) files.push(path);
    }
  };
  visitDirectory(join(process.cwd(), "src"));

  const violations: string[] = [];
  const inspect = (node: ts.Node, source: ts.SourceFile, inForm: boolean) => {
    const check = (opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, insideForm: boolean) => {
      const name = opening.tagName.getText(source);
      const explicitType = opening.attributes.properties.some(
        (property) => ts.isJsxAttribute(property) && property.name.getText(source) === "type",
      );
      if (name === "button" && !explicitType) {
        violations.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(opening.pos).line + 1}: native button lacks an explicit type`);
      }
      if (name === "Button" && insideForm && !explicitType) {
        violations.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(opening.pos).line + 1}: form Button must explicitly choose submit/button`);
      }
    };

    if (ts.isJsxElement(node)) {
      const isForm = node.openingElement.tagName.getText(source) === "form";
      check(node.openingElement, inForm);
      for (const child of node.children) inspect(child, source, inForm || isForm);
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      check(node, inForm);
      return;
    }
    if (ts.isJsxFragment(node)) {
      for (const child of node.children) inspect(child, source, inForm);
      return;
    }
    ts.forEachChild(node, (child) => inspect(child, source, inForm));
  };

  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    inspect(source, source, false);
  }
  assert.deepEqual(violations, []);
  assert.match(read("src/components/ui/Button.tsx"), /type = "button"/);
});
