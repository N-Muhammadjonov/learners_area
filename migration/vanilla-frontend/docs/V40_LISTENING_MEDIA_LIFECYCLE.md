# V40 Listening media lifecycle (Activity 2-4 clips, speed, Hub authored frame)

Source of truth: original `src/components/listening/FullListeningActivity.tsx` (media at roughly lines 90-105, 167-175, 252-270) and `ListeningSpeedPractice.tsx`. Native: `migration/vanilla-frontend/modules/listening/full-activity.js` and `view-lifetime.js`, `speed-practice.js`.

## Covered in V40 (executed)

| Behavior | Case | Result |
|---|---|---|
| Authorized audio request made; `preload="none"`, controls | Clip plays from its start, pauses at end | PASS (paused at 2.9 to 4.5 s for clip 0-3 s) |
| Clip sets start, plays, pauses at end boundary | same | PASS |
| Route exit mid-clip pauses the detached element and removes the audio element | Leave to hub | PASS |
| Recording unavailable (500) shows an original media message; no advance | Clip press | PASS (either `recordingUnavailable` or `momentUnavailable`, paused at 0) |
| Native addition: after a failure, the next press calls `load()` and plays | retry clip | PASS. Mutant without `load()` FAILS (`run-09`). |
| Speed control: allowed rates only; chosen rate sets `playbackRate` | Activity 2 speed select | PASS |
| Speed Check body (`speedRate` default is `allowed.at(-1)`) | Check | PASS |
| Speed state across the post-Check refresh; dropped on navigation | Activity 2 | PASS (after repair) |

Audio is a generated silent WAV (`silentWavSeconds`, 6 s, 8 kHz mono 16-bit), served as a fixed 200 response. No real recording and no audio replacement.

## Not verified in V40 (open)

- Range chunking (256 KiB), 8 MiB LRU and the two-transport limit. These belong to the shared private-media transport (`modules/listening/media/`), were not changed in V40, and were not re-run here.
- Private-media authorization failure on audio requests (401/403 on the media URL). Not run.
- Object-URL cleanup: the Activity clip uses direct `src`, so no object URL is created on the Activity path. Route exit does `removeAttribute('src')` and `load()` in `view-lifetime.js` `stop()` (code reading). Object URLs exist in `authored.js`, `authored-progressive.js` and `media/opaque-range-v11.js` (Hub authored frame and others). Not verified in V40.
- Abort and stale fencing of an in-flight media request on source replacement. Not run.
- Original seek restrictions: none found in the Activity media code I read. Not separately tested.
- Hub authored-frame media (load, init, teardown, source replacement, stale callbacks, error, session revocation). Not run.

## Hub authored frame

`sandbox="allow-scripts"` only is covered by V39 (authored kind renders sandboxed frame). Authored-frame media is open. See the Hub closure doc.

## Hardware and Safari

No device, Safari or real-audio claim. Playback is validated only as JavaScript state in Chromium with synthetic media.
