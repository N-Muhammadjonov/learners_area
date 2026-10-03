# §19 Global static forensic sweep — 2026-10-03

Counts are `grep -rIF -c` totals per tree (node_modules/.next excluded), taken before the fixes in this pass.

| Term | src | tests | docs | scripts | Classification | Action |
|---|---|---|---|---|---|---|
| Coming soon | 0 | 0 | 7 | 0 | DOCS-ONLY (ledger notes that tiles were NOT copied) | none |
| intent_failed | 5 | 6 | 14 | 0 | INTERNAL (comments explaining the fixed root cause) / TEST-ONLY | none |
| unknown_error | 0 | 0 | 2 | 0 | DOCS-ONLY | none |
| metadata_invalid | 0 | 0 | 1 | 0 | DOCS-ONLY | none |
| No course configured yet. | 1 | 1 | 0 | 0 | SAFE: honest localised empty state on /live-classes | none |
| TODO / FIXME | 0 | 0 | 0 | 0 | — | none |
| placeholder | 69 | 7 | 5 | 4 | SAFE (input `placeholder=` attributes, i18n keys, comments saying "no placeholder"); seed.ts = dev seed | none |
| mock | 112 | 45 | 12 | 2 | SAFE: the IELTS **mock exam** product feature (`/mocks`, MockBandPanel) | none |
| demo | 51 | 2 | 18 | 49 | seed.ts / `demo_ai` legacy enum = INTERNAL; **`auth.resetSubtitle` = USER-VISIBLE DEFECT** ("…in this demo", promised a reset link that deployed hosts never show) | **fixed** (EN+UZ), guard SG2 |
| hardcoded | 2 | 1 | 7 | 0 | INTERNAL comments | none |
| console.log | 12 | 0 | 0 | 288 | INTERNAL: `src/db/seed.ts` (dev-only seeding CLI); scripts are CLIs | none |
| alert( | 1 | 8 | 0 | 0 | **USER-VISIBLE DEFECT** (staff): native `alert()` in ManagedMaterialCard; same file swallowed DELETE failures silently | **fixed**: inline localised `role="alert"`, guard SG1/SG3 |
| Checked by | 10 | 8 | 1 | 6 | SAFE: i18n label + comments; learners always see "Checked by RIWI" (E1–E5) | none |
| OpenAI / Anthropic / Claude | 9 / 3 / 1 | — | — | — | INTERNAL: adapter display names in server-only provider modules (staff provenance only) | none |
| Gemini / Grok / Groq / Qwen / DeepSeek / Mistral | 0 | 2–6 | 1–3 | 0 | TEST-ONLY / DOCS-ONLY (provider matrix) — no vendor name in learner code | none |
| 1000 | 67 | 57 | 6 | 4 | mostly ms/timers/zod max lengths = SAFE; retention cleanup round bound = INTERNAL (next run continues); **student pickers capped at 1000 with no way to reach #1001 = USER-VISIBLE DEFECT** (reports page, new roster page) | **fixed**: name filter (wildcard-escaped, RP18) + visible "list capped" notice |
| limit( | 94 | 4 | 0 | 0 | bounded display lists with deterministic ORDER BY; Retention/Progress aggregates already structural (>1000 tests) | none |
| slice( | 222 | 104 | 0 | 86 | SAFE: string/array trimming for display and input bounds | none |
| NEXT_PUBLIC_ | 12 | 6 | 1 | 1 | SAFE: brand name, support contact, public URL only — no secret uses the prefix | none |
| DATABASE_URL | 1 | 32 | 24 | 111 | SAFE: server-only `src/db/client.ts`; tests/scripts use the isolated QA DB | none |
| SECRET / TOKEN | 15 / 19 | 54 / 2 | 7 / 0 | 10 / 2 | SAFE: server-only env reads (AUTH_SECRET, R2, Telegram, Live Partner signing); readiness reports names only, never values | none |

SECURITY DEFECTS found: **0**. USER-VISIBLE DEFECTS found and fixed: **3** (reset copy, alert()/silent delete, capped pickers).
