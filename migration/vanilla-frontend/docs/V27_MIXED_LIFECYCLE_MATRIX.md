# V27 mixed lifecycle matrix

Evidence: preseal supported browser run; final exact ZIP verification in V27_VERIFICATION.json must independently reconfirm these names/outcomes. Existing accepted cases are reused where they execute the exact combination, not relabeled as new tests.

| # | Journey | Status | Executed case |
|---|---|---|---|
| 1 | Check -> source replacement | IMPLEMENTED AND VERIFIED | V27 mixed Check -> source replacement |
| 2 | Retry -> Back -> Forward | IMPLEMENTED AND VERIFIED | V27 mixed Retry -> Back -> Forward |
| 3 | Audio -> another-tab retake | IMPLEMENTED AND VERIFIED | V20 actual other tab retake without any A write invalidates standing transcript and owned audio |
| 4 | Lexical selection -> session expiry | IMPLEMENTED AND VERIFIED | V27 mixed Lexical selection -> session expiry |
| 5 | Pending POST -> reload | IMPLEMENTED AND VERIFIED | V19 actual two-tab held Review reload never clears foreign/stale original or duplicates submission |
| 6 | Recovery Check -> source replacement | IMPLEMENTED AND VERIFIED | V24 disposed recovery Check cannot reject replacement UI on late failure |
| 7 | Recovery Adopt -> navigation | IMPLEMENTED AND VERIFIED | V27 mixed Recovery Adopt -> navigation |
| 8 | Modal -> retake | IMPLEMENTED AND VERIFIED | V26 modal held folders canonical retake disposes isolation and fences late continuation |
| 9 | Held material -> logout | IMPLEMENTED AND VERIFIED | V27 mixed Held material -> logout |
| 10 | Held media -> route exit | IMPLEMENTED AND VERIFIED | V22 real held audio initialization route cancels queued playback without late resurrection |
| 11 | Pending write -> canonical attempt change | IMPLEMENTED AND VERIFIED | V24 canonical retake during post never grants old scope or clears owned bytes |
| 12 | Transcript -> Check -> Retry | IMPLEMENTED AND VERIFIED | V27 mixed Transcript -> Check -> Retry |
| 13 | Long answer -> modal -> reload | IMPLEMENTED AND VERIFIED | V27 mixed Long answer -> modal -> reload |
| 14 | Evidence -> another-tab retake | IMPLEMENTED AND VERIFIED | V27 mixed Evidence -> another-tab retake |
| 15 | Error -> explicit Retry -> reentry | IMPLEMENTED AND VERIFIED | V27 mixed Error -> explicit Retry -> reentry |

Transcript opens after the original first-part Check, then native part2 Check→Retry follows; no duplicate or hidden original Check control is fabricated. Another-tab journeys use two real browser pages and canonical fixture state. Held media uses the existing encoded-audio route teardown case. Aborted requests may commit: exact pending bytes remain until authoritative own-context ACK; no rollback or exactly-once guarantee.
