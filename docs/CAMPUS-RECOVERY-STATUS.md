# Verification record

Reference: `learners_area_game(2).png` (user-provided, 1678x937 pixels).

Previous AI's archived `visual-qa/render_attempt_5.png` is 1024x571.
After resizing this archived screenshot to the reference resolution, per-channel
pixel mean absolute error is **35.23/255** (0 would mean exact match).

This metric describes the previous AI's archived screenshot, **not a new browser
render of the patched ZIP**. Browser WebGL screenshot testing could not complete
in this execution environment (Chromium's software GL initialization failed).
A successful Three.js syntax check does NOT establish visual match.

The source package now contains fixes for labels, navigation paths, camera
trackpad axes, preserving orbit on return, and destruction of mounted scenes.
Further actual-browser visual QA is REQUIRED; exact PNG equality is impossible
for arbitrary orbital angles.

Sources recovered from uploaded learners-area-3d-campus-source.zip.
