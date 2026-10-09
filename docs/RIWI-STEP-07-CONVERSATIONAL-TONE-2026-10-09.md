# RIWI step 07: warm conversational tone

Requested behavior: RIWI should converse with a little warmth and use emojis appropriate to its answer.

## Implementation

- The shared RIWI assistant prompt requests a warm, respectful, supportive tone in the requested language, concise explanations, and encouragement grounded in actual learner work.
- It requests a small number of relevant emojis, usually one or two, when useful. Exact quotations, citations, code, scores, and source facts remain intact; serious or sensitive answers avoid playful emojis.
- Uzbek and English chat welcome messages greet each supported role with a friendly hello and a waving-hand emoji.
- The provider transport regression verifies Unicode/emoji preservation in the normalized JSON answer, transmission of the RIWI tone instructions, and separation from grammar grading instructions.

## Validation

- Focused provider, router, gateway, chat integration and feature integration suites: 29 passed, zero failures or skips.
- UI suite: 234 passed, zero failures or skips.
- Local typecheck, lint, production build and whitespace checks passed. The handoff script reruns the complete backend suite, UI suite, typecheck, lint and build before commit and push.
- Mocked transport checks establish prompt delivery and response preservation. Actual model tone remains subject to live-provider acceptance testing; this change does not establish completion of every RIWI requirement.

Base commit: `6705a22713e94a9777da8f464735ac56d6221272`.
Target branch: `arena/01a10bac-learners-area`.
