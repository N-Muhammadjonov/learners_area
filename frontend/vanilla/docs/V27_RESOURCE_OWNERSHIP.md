# V27 resource ownership — bounded parent-realm observations

The existing modal owner had a separate application-side retention problem: its strong owned-inert Map kept removed sibling subtrees until dismissal, and external dialog removal left the focus listener and observer installed until route abort. The V27 repair prunes/restores removed siblings during real mutation delivery and stops isolation on disconnection. No animation cancellation, style change, delayed focus restoration or new authority controller is used. Unit and supported browser tests cover both cleanup paths.

## Initial / observed peak / settled

The preseal six-cycle source-replacement/route-exit run records13 named stages in `evidence/v27/resources.json`; final independently executed values are embedded in V27_VERIFICATION.json. These are sampled-stage maxima, not continuous native high-water marks.

- Initial:2 documents,770 nodes,224 allocated JS listeners;1 timeout;0 intervals/RAF;1 MutationObserver;7 live unaborted weakly tracked parent AbortControllers;1 paused authorized Audio with source;1 iframe;0 URLs/dialogs/pending fetches.
- Observed native sampled peak:867 nodes/225 listeners. These counts include browser/native/harness objects, not just live application DOM. A transient peak is not automatically a permanent leak.
- Last route-disposed sample:1 document,444 nodes,184 listeners;2 timeout owners;0 intervals/RAF/URLs/dialogs/iframes/pending fetches;4 live unaborted parent controllers;no retained parent Audio objects. Instrumented in-flight fetch peak2 observes fetch completion at response headers, NOT all body/Range jobs.

The two remaining timeout stacks identify the live shell authority-expiry scheduler (`js/authority.js`, watchAuthority) and code-only module prewarm (`js/module-prewarm.js`, createShell). Their current-route lifetimes are not old-source timers. The single remaining MutationObserver's constructor stack identifies Playwright `InjectedScript._setupGlobalListenersRemovalDetection`, not an application observer. This directly separates a harness-owned resource from application cleanup; do not “fix” the website to delete the harness observer.

Each of six route-disposed samples requires no iframe/URL/pending fetch/RAF, no active or sourced orphan Audio, and no growing observer/timeout count relative to the first equivalent disposed sample. Wrappers retain numeric handles/stack strings and WeakRefs, not target DOM nodes. WeakRef counts are sampled after diagnostic GC; dereferencing itself affects that job's liveness. The observer instrumentation stores numeric metadata and cannot prove the lifetime of every browser-native observer. ResizeObserver is instrumented where available; no separately observed active ResizeObserver is invented.

## Additional existing owners exercised by full regressions

- V25 six enter→play→Check→transcript→Retry→replace→exit cycles exercise actual encoded-fixture playback, revoked URL/media cleanup, authority listener balance and six own progress writes. The new unplayed source probe does not replace that playing-media evidence.
- V26 twenty-four modal cycles supply a separate repeated modal/listener/node measurement. Flat samples remain bounded evidence, not proof of universal leak freedom.
- Existing held-media/route, other-tab retake, pending-POST/reload, recovery-Check/replacement and explicit-Adopt/navigation journeys exercise the existing media, bridge, journal and writer scopes. They do not invent transport/ACK guarantees. Original256KiB chunks/8MiB LRU/max2 transports and sandbox/CSP are unchanged.
- Existing original-question focus/notes/history and12-condition modal/recovery/long-answer cases exercise owned focus and scroll continuations. RAF cleanup counts do not substitute for functional focus assertions.

## Attribution limits and remaining gate

CSSAnimation/DocumentTimeline retention remains the independently reproduced browser-native path in the preserved earlier investigation. The now-fixed modal Map/observer path is an independent application owner. The remaining sampled MutationObserver is explicitly harness-owned. Other native targets, opaque iframe realms, network bodies, Range/MSE jobs and every AbortController allocation are not universally attributed by these parent wrappers. Settled counts do not establish universal safety or infinite-run bounds. No additional application leak is independently demonstrated in this bounded run; that is not a no-leak theorem.

The original strict Phase2 node/listener assertion is unchanged. A new baseline pass does not turn either historical3PASS/1FAIL series into4PASS or close stability acceptance. Review remains PARTIAL; no Script/Reading promotion.
