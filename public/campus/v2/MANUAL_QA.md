# Learners Area 3D Campus — consistent neon and preserved shell

Working branch: `arena/learners-area-next`.
Starting commit: `67981049740a34f8b80d25b6d5e480cfaeb73e4b`.
Source branch: `arena/learners-area-next`. Main is unchanged.
This is a branch revision, not a production deployment or full release acceptance.

## Latest changes

- The offscreen HDR scene target now uses up to four hardware-supported MSAA
  samples before bloom. Canvas-only antialiasing did not cover this target,
  which left thin neon susceptible to stippling at oblique camera angles.
  All round neon guides and LED cores now use 16 radial segments. Neon uses
  unlit material with camera-independent color rather than directional shading.
- Ground-road core, fringe, red/white/blue current heads/trails and junction
  glows have exactly 95% of their previous linear color energy. Perimeter
  brightness and building/roof lighting are retained.
- Three more embedded components were added: eight total, all within the slab.
- The existing Topbar, CampusTopbarBrand and ShellUtilities components remain
  byte-for-byte unchanged from the starting commit. They retain the LA mark,
  “Take your learning journey with us”, GlobalSearch, Day/Night, UZ/EN and
  Profile. The bottom launcher still expands upward to ReportProblem, AI Coach
  and Focus on the campus; campus layers do not replace these controls.

- The user's 246x224 uploaded detail crop was viewed. It shows a shallow cyan-lit
  processor/control panel and a stepped blue electrical housing with a cyan
  collar. All desktop monitor/keyboard/server props from the prior interpretation
  were removed. Eight low embedded mechanisms now alternate between these two
  forms, including recessed chips, contacts, vents, small indicator lights and
  a layered housing. These are procedural 3D components, not pasted images.
- Every module road uses the same luminous blue guide material, radius and power
  as the others; Writing no longer has an inherently brighter guide color.
  Each of the eleven routes carries three separated red, white and blue current
  pulses, with per-color emission adjusted so all three remain visible.
- Side LED dashes retain their previous physical dash length; the gap between
  successive dashes on each straight edge is exactly twice its old length.
  Corner margins absorb the remaining distance without joining the dashes.
  Both rows keep their sequential traveling on/off animation.
- A separate continuous blue/cyan lower perimeter now sits below both dashed
  rows, outside the slab bevel. Its light remains constant while the dashes move.

## Earlier requested behavior retained

- Rectangular ground, no Live classes extension. All eleven pavilions stay on
  the slab, uniformly 11% larger with their proportions retained. Assignments
  is at the outer corner beside Live classes. Initial opaque silhouettes do
  not overlap; all eleven landmarks are inside the initial view.
- The rocket remains 10% larger, ivory/orange, rotating under one official LA
  logo. Camera-facing rooftop landmarks, readable ABC letters, contrasting
  Speaking/Live/Mock symbols, roof-clear headphones and clipboard, and a
  slightly upright whiter book remain in place.
- Dashboard radial dashes, ring bulbs and halos rotate with their ring group.
  Building hover grows the actual geometry. Colored rounded label borders,
  a 1.08 base label scale and the complete TED / PODCAST pill remain in place.
- Official Three.js 0.186.1/addons stay local with license and provenance.

## Latest verification — 2026-10-23

- **24 campus checks passed, 0 failed.** Real scene geometry is exercised,
  including full-resolution opaque triangle silhouettes, model/rocket scales,
  roof clearance, four-azimuth landmark facing, hover, slab bounds, route
  continuity, all three colors on every road, equal guide materials, doubled
  physical LED gaps, continuous stable lower rim, and embedded components with
  no desktop-computer object. Dashboard detail rotation and gesture separation
  also pass.
- Typecheck, ESLint, production build and `git diff --check` passed.
- Four focused UI checks passed: Focus entry/exit behavior, General Reading
  entry, profile upload/remove behavior, and utility-stack open/outside/Escape
  interaction. A source contract also checks the full campus header and launcher.
- New runtime checks verify the exact 0.95 energy ratio for core, fringe and
  each RGB current, uniform unlit materials across four camera azimuths, and
  the slab bounds of all eight embedded components.
- The latest standalone HTML preview bundles the actual source and official
  logo for offline review. It includes QA view, motion recording and report
  controls, but those controls have not been run on this latest revision.
- Latest browser acceptance is **not completed**. Browser security policy
  rejected opening the local file protocol; the supported local HTTP preview
  alternative failed because binding 127.0.0.1:4179 is denied (EPERM). No alternate
  browser surface or execution workaround was used after that rejection.
- The uploaded component reference itself was visually inspected in the in-app
  browser. Pixel-perfect matching of the modeled mechanisms is not claimed.

## Prior revision evidence and broader release gate

The previous revision passed 19 campus checks and native-Safari renderer QA,
with all 12 labels visible/contained at 1.08 scale, exact camera restoration,
road currents, side LED chasing, rotating Dashboard details and rocket motion.
Those screenshots and recordings predate the latest components/RGB/lower-rim
changes and are not presented as current browser acceptance.

The earlier full application suite reported 1,525 passed, 10 failed, 111 skipped.
Seven source-contract failures reproduced on the unchanged starting commit;
two live tests could not bind localhost (EPERM). Listening import ran out of
memory in the full run; its isolated baseline rerun with a 4 GiB heap passed
all 8 tests. A prior application UI regression run passed 336 tests. These runs
were before the latest campus revisions and have not been relabeled as passing
current full-suite results. These are unresolved broader release-acceptance limits; the current focused
checks above do not imply that the full application suite passed.

## Release acceptance still needed

Run the authenticated app in an environment that permits a local preview.
Check header/search, day/night, UZ/EN, bell/profile/utilities, real destination
pages and exact camera restoration after Xaritaga qaytish. Check keyboard/mobile
interaction and inspect the new component forms, RGB current visibility, wider
LED gaps and continuous lower rim in real WebGL. Arbitrary low-angle 3D views
may naturally occlude buildings; initial opaque silhouettes are separate.
Resolve the full-suite and authenticated-browser release acceptance before
production deployment. The owner has explicitly requested this source-branch
update with the existing validation limits disclosed.
