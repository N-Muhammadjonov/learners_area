# Manual release checklist — Learners Area 3D Campus

Working branch: `arena/learners-area-next`. Never edit `main` while checking.

The committed code is a **best-effort 3D integration**; a pixel-perfect match has NOT
been established. Static source tests are not a substitute for a WebGL browser.

## Start and inspect

1. Open the authenticated Learners Area preview, visit `/app`.
2. Compare against the approved 1678x937 PNG in the visual-reference branch.
3. Verify all 11 differentiated buildings, single LA logo, Grammar gold brain,
   illuminated windows, ground circuits and fixed utility trigger.
4. Trackpad: two fingers sideways ORBIT, up/down ZOOM. Mouse drag ORBIT, wheel ZOOM.
5. Rotate to rear/side and verify actual building geometry, no detached roof icons.
6. Enter at least Listening, Grammar and Dashboard by clicking a building AND its
   on-building label; use Xaritaga qaytish and confirm exact previous orbit and zoom.
7. Verify global search, day/night, UZ/EN, bell, profile and utility controls.
8. Reset the camera, resize to mobile and back, test keyboard labels and reduced motion.
9. Review the Live classes edge support dock; the extension may require art refinement.
10. Run `npm run typecheck`, `npm test`, `npm run build` and UI tests in a full local checkout.

## Current evidence

- Offline v7 candidate checks passed (camera wheel, labels, deterministic
  motion, asset paths and safe integration).
- CI/build/WebGL screenshot were unavailable in the execution environment.
- No byte-for-byte image equality or WebGL visual fidelity claim is made.
