# Native UI refinements — 25 October 2026

Reference presentation: `main` at `b62b78f469e4f73aa80f441f630b012dc422af39`.
Target parent: `a4eee17c274031ea0a51273d7db7e65616b22a86` on `arena/learners-area-next`.

- Restore Main's welcome animation periods, including its explicit reduced-motion overrides. Remove the programmatic heading focus rectangle.
- Keep one row of Main/search/preferences/notification/profile controls. The campus shows its brand and white tagline. Nested workspaces show `← Main`.
- Remove the rendered sidebar and hamburger. Preserve its authorized Management destinations as cards, including Support. Remove the redundant Management title, description and in-page return link.
- Place the existing module section headings and live tab nodes in the pinned header band. Preserve their handlers, URL state and content lifetimes. Listening uses the current `/app/listening/tests` destination.
- Match all 630 unique Main stylesheet selector/context groups and their effective declarations. Native campus/shell rules remain separate, explicit layout exceptions. Runtime remains HTML, CSS and native JavaScript over FastAPI.
- Attach badges to their projected building anchors with no screen collision displacement or viewport clamping. Foreground building geometry hides covered badges. Reduce TED/PODCAST by another 20 percent and other badges by another 10 percent.
- Use a light, rounded conical keep roof. Double the Uzbekistan flag and deform its stripes, crescent and twelve stars with a shared cloth wave; keep its hoist fixed.
- Restore the two independent, oppositely moving LED dash rows. Keep the existing continuous lower perimeter.

Validation:

- Frontend: 941 passed, 11 existing skips, zero failed.
- Campus geometry, occlusion, flag, access and visual contracts: 30 passed.
- Native module mounts using captured real ASGI/disposable PostgreSQL response samples: 96 passed.
- Main CSS declaration comparison: 630 selector/context groups, zero missing and zero differing declarations.
- Static build: 442 runtime files, 119 routes. Python ASGI startup check passed.
- Native and public campus source copies are identical. No backend, database or migration changes.

Visual limit: the local Chrome process terminated before its debugging connection opened, so this change has no new Chrome/Safari screenshot certification. The legacy Listening V23 jsdom fixture also logs its pre-existing missing `scrollIntoView` diagnostic; it does not occur in a browser and its tests pass.
