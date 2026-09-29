# Shared lexical interaction — closure

Current evidence and classification: [WORK-FINAL-AUDIT.md](WORK-FINAL-AUDIT.md).
Actual cross-surface inventory and authority model: [LEXICAL-ARCHITECTURE.md](LEXICAL-ARCHITECTURE.md).

Final full suite: **300/300** with real DB enabled. Shared React DOM cases: **15/15**, nested inside one suite wrapper. Typecheck/lint/build passed after the final runtime edits; closure repeats those gates without new runtime changes.

Words are plain spans with original separators, no per-word buttons or tab stops, no hover pill and no per-word padding. Each text region has one labelled keyboard entry. Left/Right/Home/End select; Enter opens; Escape returns region focus. Native gestures are not prevented. Drag >8px, noncollapsed selection, hold >=500ms, cancellation, context menu and multiple clicks suppress lookup. Intentional pointer lookup waits 240ms so a second click can become native selection before dialog focus.

Reading popup measured within viewport at 320/360/375/390/393/768/1024/1440; 320px bounds x=8..312. Reading, Vocabulary, Listening transcript and synthetic video/material representative pages showed no horizontal overflow at those widths. Keyboard lookup observed in Reading, Listening, video and material text. Escape focus restoration observed in Reading. Existing outside-close/scroll/async-state behavior is DOM regression evidence, not a new physical-pointer certification.

**POINTER/DRAG NATIVE SELECTION — TOOLING-LIMITED / EXTERNALLY UNVERIFIED.** Native automation did not reliably select prose at desktop or 320px; screenshot/DOM coordinates diverged. Double-click selected a newline. No assertion of successful native drag, copy or physical mobile long press is made. No product defect was established by these tooling attempts.

Manual retest on the deployed approved build: drag both directions across word boundaries; copy selected phrase; outside click clears; double-click selects a word without conflicting popup; then ordinary word click opens; Escape restores focus. On a real phone, long-press and selection handles must remain usable. Repeat near first/middle/bottom lines at 320px, during scroll and resize.

Synthetic video/material fixture proves text UI only, not external provider playback. Screenshots/raw measurements are outside Git under outputs/work. No private reference archives are committed.
