# Authoritative timing handoff — no frontend/content correction made

Tests10/25 are not counted as accepted valid sources. Exact per-question/part observed values and original numerical audit provenance are preserved in `evidence/v26/unavailable-mapping-{10,25}.json`; `evidence/v27/timing-handoff.json` enumerates every correction request separately.

- Test10 contains zero/unavailable and invalid ordered clip mappings. The original question timing range must be finite, positive and ordered within the authoritative part bounds. Frontend must fail closed, not infer/clamp a recording position.
- Test25 Q30: part3 clip1205–1236 exceeds part end1235.879 (part begins886.613).
- Test25 Q40: part4 clip1510–1525 exceeds part end1524.01 (part begins1329.645).

The authoritative Listening content/media owner must reconcile the existing original question mapping and part bounds against the original authorized recording, approve corrected values and publish through the existing workflow. No assignee identity or corrected timestamp is invented here. This is outside the frontend migration and not permission to edit original HTML/audio, questions/answers, canonical IDs, publication data, API mappings, backend or database. GPT Work's separately authorized backend/dictionary scope remains independent. No endpoint or production probe is added.
