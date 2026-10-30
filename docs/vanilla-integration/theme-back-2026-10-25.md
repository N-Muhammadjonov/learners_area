# Theme contrast and responsive return navigation

Day/Night changes could leave dark text on dark Dictionary surfaces, white text on light Focus controls, and low-contrast status text. The native header also always returned to Main from staff and Speaking details. These changes keep foreground colors with their painted surface and give nested workspaces a real Back action.

## Return behavior

- Listening, Reading, Writing, Grammar and Vocabulary keep `← Main`; their section navigation is already visible.
- Staff details return through recorded in-app browser history. A direct link falls back to the nearest registered parent, or Management for a staff root.
- Speaking practice query steps have explicit parents: topic → part → practice → Speaking.
- Back shows only `←` on widths up to 767px, portrait tablets up to 1024px, and phone landscape up to 950×500px. Other sizes show `← Back`. The localized accessible name is present at every size. Main keeps its label.
- Modified link clicks retain native browser behavior. Back accepts only safe in-app history; external history is not used as its fallback. Navigation state stores the prior URL, with no copied session or identity object.

## Palette changes

Foreground and status tokens now follow light Focus surfaces or dark glass surfaces. Dictionary, media, dialogs and flashcards retain local dark palettes. Night accents distinguish the accent text from the text on an accent fill. Glass opacity is .88 in both themes so bright wallpaper does not wash out light text. Explicit status colors in staff editors/import validation now use the themed success/warning/error tokens. Login footer, selected locale controls and game answer feedback also retain contrast.

## Navigation structure

The HTML/CSS/vanilla JavaScript shell persists across normal private navigation. The router uses an exact-path Map and precompiled regular expressions for parameters, `pushState`/`replaceState` and `popstate`, and lazy ESM module loading with code prewarming. FastAPI supplies page data. Bounded metadata caching is separate from attempts, answers and staff state. A healthy internal navigation does not call `/api/auth/state`; protected API actions still enforce authorization. The new Back action uses the same router and does not introduce another session request.

## Validation

- Native suite: 996 passed, 0 failed, 11 existing skips (1007 total).
- Actual native games: all seven initial/answer states, including correct/incorrect race feedback; login/register/reset, onboarding/pending, Dictionary errors, modal controls and media text checked in all four Day/Night × Focus combinations.
- Responsive header and safe history/direct-entry fallback tests passed.
- Expanded route contrast audit: 105 route/query states × 4 palette combinations = 420 cases; 20,320 direct-text checks, 0 contrast failures and 0 unresolved colors. This includes staff and Speaking failure states where an isolated fixture is unavailable.
- Python-only static build: 458 runtime files, 119 routes; ASGI startup check passed. Node is development/test tooling only.

The contrast checks evaluate the CSS cascade on actual native DOM with isolated API fixtures. Missing fixtures exercise the real failure UI and are recorded per route. They do not verify image pixels, iframe contents, layout, animations or browser paint, and do not certify pixel-perfect appearance. No database schema or production data was changed.

Run the optional isolated-data audit with `node scripts/audit-theme-contrast.mjs /path/to/isolated-wire.json`; set `THEME_AUDIT_REPORT` to choose the JSON output path. It permits GET requests from the fixture only.
