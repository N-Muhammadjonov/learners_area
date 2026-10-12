# Speaking topic authoring

Part1/3: section → Part → topic name → question + its optional Vocabulary/Model answer/Ideas → Add question → repeat → Upload topic. The request saves every question in one transaction; a partially published topic cannot result from a later write failure. Practice and Partner read the same canonical rows. Helpers remain exclusive to Practice.

Part2: section → Part2 → topic/cue-card name → optional explicit cue question (name used if left empty) → cue points, one per line, including an optional Part3 topic note → helpers → Upload topic. One cue card has one recorder.

Existing topics load as a whole. Their name, question text, cue points and helpers can be edited; questions can be added or removed. Upload changes publishes the group. Removed questions and removed topics are archived, preserving existing attempt/vocabulary references. Archived topics can be opened and republished. No new database migration is required.

The API requires an active administrator. Original group IDs are checked before writing; changed membership or a conflicting target topic returns409 with no partial mutation. Owner topic transactions serialize concurrent group writes. A second editor changing the content of the same unchanged group still follows last-save-wins; this version does not claim revision-based content conflict detection.

R2: owner-approved policy saved on existing private learners-area-preview. Real Listening ZIP upload finalized and attached; published test2538af07-787e-4772-a7a8-cdd6f54a055f,16450918 bytes. Browser playback loaded duration1645.034671 seconds and advanced. Safe receipts under docs/receipts; screenshot evidence outside Git. Production untouched.

Actual isolated-owner browser QA passed: Part1 two questions/one Upload/one learner topic; rich Georgia/bold/italic answer preserved; rename/archive/restore; Part2 name fallback plus five cue-point lines and sample answer; Part3 two-question Upload, remove one, rename and save again. Native database receipt confirms four published rows, one archived row and shared channels. Owner form measured375px and1280px with no horizontal overflow. Physical microphone acceptance and live two-user audio remain unverified. Canonical gates12 and13 both PASS on unchanged executable source: native PostgreSQL1048/1048 with zero skips; UI206/206; PGlite958 pass plus90 native-only skips; typecheck/lint/build and working/committed-range whitespace checks PASS. Final Preview deployment still pending.
