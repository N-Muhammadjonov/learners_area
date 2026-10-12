/** Bundle using the esbuild dependency already pinned by tsx in package-lock.
 * The emitted CommonJS job needs Node only after the build dependencies prune.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", { paths: [dirname(require.resolve("tsx/package.json"))] }));
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["scripts/riwi-chat-retention-job.ts"],
  outfile: ".riwi-jobs/chat-retention.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  conditions: ["react-server"],
  external: ["pg-native"],
  sourcemap: false,
  logLevel: "warning",
});
console.log("RIWI retention job bundled; no database connection or cleanup executed.");
