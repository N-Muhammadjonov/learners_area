# Global instant interaction architecture (focused Part 1)

**Status:** implemented in source; browser acceptance is **EXTERNALLY UNVERIFIED**. This document audits interaction/navigation/performance architecture only. It does not certify unrelated Part 1 product defects or begin Part 2.

## Scope and reference principle

The supplied design principle is: acknowledge a destination/view change locally first, then synchronize URL/history and continue asynchronous work. `Pasted text.txt` was not present in the searched workspace, so this adaptation uses only the principle supplied in the request; no source implementation was inspected or copied.

The adaptation is intentionally Next.js-native: `InstantLink` and normal `next/link` links retain Next URL/history/deep-link behavior; programmatic route transitions use `router.push`/`router.replace`; browser Back/Forward remains browser/Next-owned. The private navigation provider does not mutate history directly or replace Next routing. Existing Vocabulary tab/game filters use Next's patched native `history.replaceState` only to serialize local view state; they do not navigate or replace the router. Local-first applies to visible feedback and view state—not authorization, protected records, scores, access decisions, or mutation success.

## Architecture now in source

- `src/app/(app)/layout.tsx` remains the persistent authenticated shell. Its database-backed `getCurrentUser()` and `hasPrivateAccess(user.accountStatus)` gates are unchanged and run before rendering the private layout.
- `InstantInteractionProvider` wraps that existing shell, not each page. Sidebar, top bar, utilities, and their scroll containers stay mounted across private-route transitions.
- `InstantWorkspaceOutlet` replaces only the main workspace contents after an internal navigation intent. It immediately shows the known destination label, accessible status, and a data-free skeleton while the route has not committed. This is immediate route feedback, not proof that destination data is usable. It never paints guessed page data.
- `SidebarNav` derives a pending destination from the local navigation intent before `usePathname()` changes, so its active `aria-current` row and management mode respond immediately. The committed pathname remains authoritative after routing settles.
- Native internal links preserve modifier-click, new-tab, download, external-origin, hash-only, deep-link, query, refresh, and Back/Forward semantics. On route commit, ordinary link navigation focuses the main landmark and starts its scroll at the top; Back/Forward restores the prior main-scroll offset keyed by path and query. The provider intercepts only an unmodified, same-origin primary navigation for local acknowledgement. `popstate` creates the same acknowledgement for Back/Forward. Search and successful attempt/content creation use the provider's `navigate()` helper after the server confirms the operation.
- `LinkPending` remains as a secondary Next link status for sustained waits (60 ms); it no longer has to be the first feedback because the outlet changes immediately.
- `src/app/(app)/loading.tsx` is a segment loading boundary. Sidebar `InstantLink` uses Next automatic prefetch (`prefetch={null}`), not blanket `false` or forced full-page prefetch. This boundary reads only the locale dictionary, has no DB/API/private-record query, and makes the default dynamic-route prefetch stop at a small loading surface. Other module links keep normal Next behavior.
- Dashboard, Grammar, Listening, Speaking, and Writing now stream their authenticated module heading/entry links and granular data-free skeletons while summary/catalogue queries complete. Grammar starts topics, visible exercises, and attempts together; its attempt join retains both the requesting user filter and `grammarVisibleTo(userId)`. Writing keeps its prompts/resources and learner typing summary parallel. Listening/Speaking and Management overlap independent locale and active-user/staff lookups, while user-scoped data reads still wait for auth. Route diagnostics separate first response, usable header/view, and the completion of marked async regions.
- Shared future-control primitives are in `InteractionPrimitives.tsx`: `AsyncActionButton`, `useAsyncAction` (same-tick duplicate guard, pending state before awaiting, completion/error instrumentation), and `ConfirmAction` (native modal dialog, focus handling, pending/disabled confirmation, failure feedback). `Button` defaults to `type="button"`, form submit buttons opt into `type="submit"`, and a TypeScript-AST test enforces explicit native button types plus explicit submit/button choice for shared buttons inside forms. The shell logout control now uses confirmation and only leaves the page after a successful logout response. Locale switching acknowledges pending work immediately, checks the HTTP result, retains the current language on failure, and refreshes only after persistence succeeds.
- Global pressed-state/touch-action feedback is in `globals.css` and honors reduced-motion preferences. It applies outside the private shell too. Preview/local diagnostics are gated by `performanceDiagnosticsEnabled()` and disabled in production.

## Interaction contract and future-control template

Classify before implementing:

| Class | Examples | Immediate local response | Authoritative completion |
|---|---|---|---|
| A — navigation | Sidebar, cards, search result, deep link | Keep shell; show destination outlet/loading boundary | Next route/RSC commit; preserve native URL/history |
| B — local view | Tabs, dropdowns, filters, dialogs, theme | Update selection/open state in the event; expose `aria-selected`/`aria-expanded` | No server completion unless persistence exists |
| C — data view | Search, paged list, query filter | Keep current view usable; show scoped pending/empty/error state | Render only server-authorized response; cancel stale requests |
| D — mutation | Save, submit, join, review, mark read | Set pending and disable duplicate submission before `await`; do not claim success | Await API/server action; apply returned authoritative result or refresh affected projection; show error and recover |
| E — destructive/security | Delete, role/status/permission change, sign out | Open an accessible confirmation immediately; pending on confirm | Server rechecks actor/target/ownership/rank; close only after confirmed outcome |
| F — external | Mail, download, external provider | Preserve browser-native behavior | Do not route through the private workspace shell |

**Future async-control template (illustrative):**

```tsx
const { pending, run } = useAsyncAction("mutation");
const [error, setError] = useState<string | null>(null);

<form onSubmit={(event) => {
  event.preventDefault();
  setError(null);
  void run(async () => {
    const response = await fetch("/api/example", { method: "POST", body: formBody });
    if (!response.ok) {
      setError("The change was not saved. Try again.");
      return;
    }
    const authoritative = await response.json();
    setViewFromServer(authoritative); // never synthesize a success result
  }).catch(() => setError("The service could not complete the change."));
}}>
  <AsyncActionButton type="submit" pending={pending} pendingLabel="Saving…">
    Save
  </AsyncActionButton>
  {error && <p role="alert">{error}</p>}
</form>
```

Use `ConfirmAction` for E-class actions. Use Next links/router helpers for A-class changes. Keep tab/filter selection local and expose the selected state to assistive technology. Never copy user data into `localStorage`, a process-wide cache, or a shared client cache.

## Authorization, cache, and invalidation review

- No new client data cache, persistent cache, or shared cache was introduced. Navigation intents contain only a destination string, fixed workspace key, random correlation id, and timestamps; diagnostics never log user text, ids, query values, or credentials.
- Private page rendering remains request-dynamic through the authenticated layout. A static scan found 59 private page routes; those not calling `requireActiveUser()`/`getCurrentUser()` directly instead call role-specific DB guards (`requireAdministrator`, `requireStaff`, or `requireOwner`). APIs continue to authorize their own reads and writes. Client state is never an authorization grant.
- Automatic prefetch is bounded by the new static loading boundary; no page-specific server data is inserted into a custom prefetch cache. The browser's Next Router Cache is framework-owned and tab-local, not shared across users. Logout remains server-confirmed; server gates remain authoritative on fresh route/API requests.
- No authorization/admission/ownership/role/privacy/QA2 guard was weakened. No DB mutation, migration, production action, or main-branch merge was made.
- `router.refresh()` calls were inventoried rather than globally removed. See `GLOBAL-INTERACTION-CONTROL-INVENTORY.md`; retained calls sit after server mutations whose current visible projection comes from server-rendered state, and after auth/locale/session changes. Blindly replacing them with optimistic success would be unsafe. A future targeted refactor can replace an individual refresh only when it can apply the complete authorized server response to every affected read model.

## Diagnostics and measurement meanings

The private provider and `PerformanceDiagnostics` emit privacy-safe `[qa-perf]` records in Preview or an explicitly opted-in non-production environment. `GlobalControlDiagnostics` covers public/auth controls and deliberately skips `[data-shell]` so the private provider is not double-counted.

- `interactionStart`: activation/category/fixed control family; no text, values, path ids, or query strings.
- `firstResponsePaintOpportunity` (provider) and `firstVisibleResponse` (browser diagnostic): elapsed time to a double-animation-frame paint opportunity after the local response. These are frame proxies, **not** proof from a compositor trace that pixels changed, nor a Lighthouse/INP score. Browser validation must confirm the actual visible response.
- `usableView` from `PerformanceDiagnostics`: click-to-usable-view time after the URL matches and route/workspace loading markers are gone; nested async-region placeholders do not block this earlier usable header/view. Active-state changes alone are never counted. This browser-only diagnostic remains **EXTERNALLY UNVERIFIED** without Preview/browser evidence.
- `asyncDataCompletion`: click-to-settled route-content timing, waiting for the route boundary and marked async regions to finish. For route surfaces without granular markers it settles when the route boundary resolves. This is separate from `usableView` and remains **EXTERNALLY UNVERIFIED** without browser evidence.
- `destinationRouteCommit` / `routeCommitLatencyMs`: elapsed client time to pathname/query route commit, including RSC and client scheduling; not pure server CPU time and not the usable-view metric.
- Existing `PerformanceDiagnostics` records same-origin RSC/API resource duration and TTFB, navigation/document timings, LCP and long tasks without logging URLs. RSC/API resource completion is the server-response proxy; it must not be conflated with first response or usable-view timing.
- `useAsyncAction` reports `asyncCompletion` for actions that adopt the shared hook. Existing one-off forms still have their own pending/error state and their network resource can be observed, but they are not all correlated to a per-action completion id yet.

No browser or Preview console automation was available in this task environment. Therefore no 15-transition warmed primary-navigation run, no representative action-class timing run, and no p50/p95 browser values are claimed. JSDOM/test-runner time is not substituted for browser evidence. Measurements remain **EXTERNALLY UNVERIFIED**.

## Static audit and remaining scope

A source-only inventory (not runtime proof) found 124 `<button>` occurrences, 103 `<Link>`/`<a>` occurrences, 11 direct `router.push`/`router.replace` occurrences after migrating the primary internal programmatic transitions, 207 `onClick=` props, and 20 forms under `src/**/*.tsx`. Page-specific controls are grouped in the companion inventory. Native Next navigation is preserved; no shared shell remount was introduced.

Twenty-seven source files contain `Promise.all`; `AppLayout` already parallelizes the current-user and locale reads. Independent page reads commonly use parallel fetches. Dependent sequences (create attempt then navigate, validate upload then create, submit then render result) remain serial by design. Static search found no `next/dynamic`/runtime chunk-loading pattern (one type-only `import()` match); route-level code splitting remains Next-managed. The production build reported 103 kB shared First Load JS; representative route totals were Reading 148 kB, Vocabulary 113 kB, Speaking Practice 110 kB, and Listening Attempt 112 kB. These are Next build estimates, not browser transfer/parse measurements. Avoid manually code-splitting the persistent shell or moving private payloads into the shared client chunk without production bundle analysis.

Loading/error/accessibility/mobile review: the shell has its own scrolling main/rail, fixed topbar, safe-area padding, mobile drawer, 44px profile-menu action, native links, labelled navigation, active/pressed states, focus-visible rules and reduced-motion styles. The new workspace status is localized, polite, busy, and scoped to main content. The new confirmation uses the browser's accessible modal dialog and returns focus to its trigger. The central app loading and error boundaries remain. The browser-specific keyboard/touch/focus/contrast and small-screen layout pass still requires Preview testing.

## Verification status

Source tests cover same-origin/deep-link/query classification, privacy-safe route keys, private server gate retention, safe automatic-prefetch boundary, Back/Forward observation, outlet semantics, immediate active state, scroll restoration, streaming module boundaries, async/destructive primitives, production-disabled diagnostics, locale acknowledgement and reduced-motion/touch rules. These checks verify source contracts, not user-visible timing. Latest deterministic sequence: targeted navigation suite 7/7 passed; `npm test` 326 passed, 0 failed, 24 skipped; typecheck, lint, production build, post-build typecheck, and `git diff --check` passed. No browser executable, Preview session, or database credentials were available; warmed 15-transition measurement and keyboard/touch/history runtime acceptance remain **EXTERNALLY UNVERIFIED**. Remote synchronization and SHA verification are still outstanding.
