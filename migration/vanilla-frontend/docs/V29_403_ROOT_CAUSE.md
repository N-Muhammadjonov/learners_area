# V29 Full IELTS403 recovery repair — harness ownership of observation

V28 historical full run417PASS/1FAIL remains failed. Exact case: V14 Full IELTS403 preserves own draft, fails closed, single-flight explicit retry;8000ms score visibility timeout,21 observations of hidden score-box. Raw failure is retained in V28_VERIFICATION.json and extracted in V29 evidence.

## Contract and ordering
The403 is the first submitted authored-state PUT, after an authorized own exam start/draft. Parent fails closed, removes frame and retains exact own pending bytes. Explicit Retry reloads the original DTO, replays own submitted bytes, receives the existing canonical40-result response (0/40), then hydrates a new opaque frame. No new server grant or scoring change.

The recovered frame has #exam. Original read-only source line182 schedules its native initial hash action with setTimeout(()=>openActivity(hash),50). Its openActivity line75 legitimately calls closeModal. The prior harness waited for EITHER hydrated hub OR any active activity and immediately invoked private showResults(). That wait does not settle initial hash navigation. The original navigation could therefore close the already correctly authorized0/40 modal, leaving its score-box nodes present but hidden—the observed symptom. This is not delayed server authorization or missing canonical results.

## Bounded evidence
One ordinary instrumented baseline case passed; it is not relabelled as reproduction of the intermittent failure. A single declared controlled-order fixture then held ONLY the original50ms hash callback, without changing source data/responses or application authorization. After hydration, the unchanged original showResults rendered an authorized visible0/40 modal. Releasing the actual original callback caused openActivity('exam') -> closeModal and hid the same modal. Trace records before/after showResults/showModal/openActivity/closeModal. After navigation the same results action rendered visible0/40. Existing puts===2 assertion passed. No CSS manipulation, original file edit, synthetic successful response change, timeout increase or suppressed navigation was used.

## Precise harness repair
The403/404 recovery branch now waits for #activity-exam.active (native initial #exam navigation complete) before invoking the original results action. Existing hydrated wait remains; original visible score assertion,0/40 value, draft/singleflight/two-PUT assertions and8000ms timeout unchanged. No application runtime change. A normal focused repaired403 case passed. Complete418-source run is executed next, before resource investigation; results remain separate and authoritative.
