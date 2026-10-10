import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";

export const AUTHORITATIVE_SOURCES = [
  { id: "A", filename: "FULL_RIWI_SUPER_MASTER_PROMPT_ARENA_2026-10-03.txt", sha256: "f046e05ff192d0df38da6cf696b99d637cbd9c5c7a4b4256692b464828b8e61e", blob: "8999cc741e257ed9f7672d9a35381b9292271323" },
  { id: "B", filename: "LEARNERS_AREA_RIWI_PROMPT_BASE_BOOK_FINAL.txt", sha256: "7b78fbae566e1b055a6a5406b193c14a11c6f49f28a43fdde02a96443ab5c2fc", blob: "15f7661b61171a797a9c9af5424ba34e4dfef899" },
  { id: "C", filename: "LEARNERS_AREA_RIWI_SPEAKING_PRACTICE_WITH_AI_MASTER_PROMPT.txt", sha256: "4134f569b09dca7bc3d41df2a24d15ebffbf388f66c9526851e8e343cb1e1683", blob: "0cdd9ba9b68638b056c88fecb6bdf7f59fa3b98a" },
  { id: "D", filename: "RIWI_SECURITY_PROMPT_FINAL_V2.txt", sha256: "5cc4793eaa2f9b3fba1c30428b38dce8695bf16ccac68bed2d637eb0f0e92911", blob: "bd7a1ef07073e99b3f81d3659cf248fe7c5dcf47" },
];
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function verifySource(source, text) {
  const bytes = Buffer.from(text);
  if (sha256(bytes) !== source.sha256 || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== source.blob) throw new Error(`source_identity_mismatch:${source.id}`);
}
export function assertNewEvidenceOutput(path) {
  if (resolve(path) === resolve("docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl") || !/RIWI-BATCH-15-CURRENT-EVIDENCE\.jsonl$/.test(path)) throw new Error("historical_ledger_write_denied");
}
export function snapshotSource(root) {
  const files = [];
  const walk = folder => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push({ path: relative(root, join(root, path)), sha256: sha256(readFileSync(join(root, path))) });
    }
  };
  for (const folder of ["src", "tests", "scripts", "drizzle"]) walk(folder);
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "next.config.mjs", "vercel.json"]) {
    try { files.push({ path, sha256: sha256(readFileSync(join(root, path))) }); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { sha256: sha256(JSON.stringify(files)), files };
}
export function parseTestReceipt(stdout, status) {
  const number = name => Number(stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN);
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, number(name)]));
  const verified = status === 0 && counts.tests > 0 && counts.pass === counts.tests && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0;
  return { exit_code: status, counts, verified };
}
