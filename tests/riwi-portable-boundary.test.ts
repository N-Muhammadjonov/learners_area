import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { runRiwiRegressionSuite } from "../src/lib/services/riwi/golden/fixtures";

/** Follow runtime imports; type-only identity definitions are not runtime
 * dependencies. This checks the whole portable subtree, not just one import.
 */
test("portable authority broker and regression anchors never import feature tables or the app database", () => {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = readFileSync(path, "utf8");
    const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    for (const declaration of syntax.statements) {
      if (!ts.isImportDeclaration(declaration) && !ts.isExportDeclaration(declaration)) continue;
      if (ts.isImportDeclaration(declaration) && declaration.importClause?.isTypeOnly) continue;
      if (ts.isExportDeclaration(declaration) && declaration.isTypeOnly) continue;
      if (!declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
      const spec = declaration.moduleSpecifier.text;
      assert.doesNotMatch(spec, /^@\/(?:db|lib\/data)\//, `feature coupling in ${path}`);
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const base = spec.startsWith("@/") ? resolve("src", spec.slice(2)) : resolve(dirname(path), spec);
      const target = [base + ".ts", base + ".tsx", resolve(base, "index.ts")].find(existsSync);
      assert.ok(target, `unresolved runtime import ${spec}`);
      visit(target);
    }
  };
  for (const path of ["src/lib/services/riwi/tool-broker.ts", "src/lib/services/riwi/site-adapter.ts", "src/lib/services/riwi/golden/fixtures.ts", "src/lib/portability/post-import-regression.ts"]) visit(resolve(path));
  assert.ok(seen.size >= 8, "the recursive dependency audit must cover more than entry points");
});

test("registered regressions execute and bind receipt to the destination state identity", () => {
  const a = runRiwiRegressionSuite("a".repeat(64));
  const b = runRiwiRegressionSuite("b".repeat(64));
  assert.equal(a.passed, true);
  assert.equal(a.checks.length, 5);
  assert.notEqual(a.evidenceHash, b.evidenceHash);
  assert.deepEqual(a, runRiwiRegressionSuite("a".repeat(64)));
});
