# RIWI checkpoint — 3 November 2026

RIWI uses the existing internal rule mechanism. No external AI or self-hosted language model was connected.

Tested runtime commit: `6ca84c16c50af6384ebdd1cc74898b508a14f2bc` on `arena/learners-area-next`. The final checkpoint also records a test-only adjustment and these QA receipts; runtime source is unchanged by that documentation commit.

[Open QA Preview](https://learners-area-git-arena-learners-area-next-learners-area.vercel.app/app/riwi)

The original 92 lessons remain intact. A separate approved source adds clearer Uzbek explanations and 552 original English–Uzbek example pairs. A lesson response gives three translated examples, a useful distinction and a practice prompt. Follow-ups use a different example set; `/simple` explains the topic in smaller steps. Query matching accepts selected misspellings, Cyrillic Uzbek and apostrophe variants. Supported sentence corrections address the learner's actual input and explain the change.

The chat follows the site’s day/night palette with iPhone-style incoming and outgoing bubbles, timestamps, a bottom composer and source disclosures. Safari was controlled in the existing QA Owner session. Actual input, responses, persistence and context changes were checked. The chat was visually inspected at 1440 × 900 and requested 390 × 844 viewports; the latter reported a 389 px inner width because of Safari’s preview scaling. No horizontal overflow or Send obstruction was measured in those full-size viewports. Physical iPhone keyboard/device acceptance was not performed.

Available commands:

- `/clear`: clear the displayed conversation and exclude its context from subsequent replies.
- `/new chat`: begin a fresh conversation, keeping the reply language selection.
- `/language eng`, `/language en`, `/language uz`: choose RIWI’s reply language independently of the website language.
- `/language`: show language buttons.
- `/examples`: three more examples of the current topic.
- `/simple`: a simpler explanation of the current topic.
- `/help`: list the commands.

Clear and new chat reset the conversation used for replies. They do not permanently delete stored account records. Unknown commands show help; unsupported questions request context instead of inventing a rule.

Verification completed:

- All **260 RIWI backend tests** passed in an isolated Python 3.14 QA environment. Repository dependency locks were not changed.
- **12 frontend tests** passed, including control commands, reply language, duplicate-send prevention, draft restoration, escaping, keyboard behavior and role boundaries.
- The native asset build passed: **513 files**, **125 routes**, revision `cb3ca0834e96368f563b`.
- All **12 live API cases** passed topic, persistence and evidence checks. All nine supported lesson cases returned three examples and both approved source references; three boundary cases abstained or refused appropriately.
- **Six actual UI teaching requests** and **13 native checks** confirmed typo matching, follow-up context, different examples, English/Uzbek replies, fresh conversation IDs after clear/new chat, and visible help.
- A separate assistant semantic read-through checked all 92 explanations, 552 example pairs and 12 live cases. This is not independent human or certified examiner approval. The rule set remains finite and does not provide unrestricted language understanding.

QA knowledge sources:

| Source | State / units | Checksum |
| --- | --- | --- |
| Original library `7e40dc30-a900-4d6e-8d7a-e992324f144d` | Active / 92 | `e87a2aa55c7f1aabf8fdfc8475d91f41a14cfa710fa16feeafd6f9e7383e5b1f` |
| Teaching details `68459d3e-75d8-45cf-9789-08ab07e04216` | Active / 92; zero ingestion conflicts | `c7ce1a5e8bb897f4b5506c4f86adf582938526c536326f4c5ef335e55c6253c7` |

Activation used the normal Owner candidate → approval → promotion flow in QA. No schema migration was performed. External AI was verified off; all recorded replies used RIWI. Synthetic QA conversations remain subject to the existing retention policy.

Primary references were consulted for factual checks. The explanations and examples are original; publisher passages, images and exercises were not imported:

- [British Council grammar](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/present-perfect)
- [IELTS Academic Reading format](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-reading)
- [IELTS Academic Writing format](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-writing)
- [OpenStax Writing Guide](https://openstax.org/books/writing-guide/pages/1-5-writing-process-thinking-critically-about-a-text)
- [Uzbek educational corpus](https://uzschoolcorpara.uz/uz/Dictionary?q=imlo)

Main was not merged and production was not deployed. Owner permission is required for those next steps. The last verified main ref was `cb3a331112bff58b889eb4b23bc0b950425985ed`; the branch was ahead with no missing main commits.

Evidence:

- [Acceptance summary](acceptance.json)
- [Live responses, requests and layout measurements](live-qa.json)
- Backend command: `PYTHONDONTWRITEBYTECODE=1 python -m pytest -q --disable-warnings -p no:cacheprovider services/backend/tests/test_riwi*.py` (260 passed).
- Frontend command: `node --test frontend/vanilla/tests/riwi-chat-experience.test.mjs frontend/vanilla/tests/riwi-integration.test.mjs` (12 passed).

Live receipt SHA-256: `b7750f82b706509663fd8de45e718430e7b164b8ecbe38f86c8d320518af7a49`.
