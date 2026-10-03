# External AI provider matrix (2026-10-03)

Proof: `tests/provider-matrix.test.ts` (PM1–PM10), `tests/universal-ai-providers.test.ts` (UA1–UA13),
`tests/openai-adapters.test.ts`, `tests/checked-by-riwi-e2e.test.ts`.
**No provider key exists in the build/QA environment, so no live call has been made for any vendor.**

Compatible-adapter contract (all six non-first-class vendors publish an endpoint for it):
`POST {baseURL}/chat/completions`, `Authorization: Bearer <key>`, `messages: [system, user]`,
`response_format: {type: "json_object"}`, `max_tokens`, `stream: false`;
reply = `choices[0].message.content` with `finish_reason: "stop"`, then strict schema validation.
DeepSeek and Qwen require the word "json" in the messages; every shared system prompt contains it (PM3).

| Provider | Adapter | API contract | Server env required | Default model source | Structured output | Timeout / retry | Provenance | Live verified | Reason |
|---|---|---|---|---|---|---|---|---|---|
| OpenAI | first-class `openai` | Responses API | `OPENAI_API_KEY`, `OPENAI_EVALUATION_MODEL` | env; owner override at /owner/integrations | JSON + strict schema validation | 20 s deadline; `AI_PROVIDER_MAX_ATTEMPTS` (retryable only) | providerId=openai, type=external, model | NO | no key in environment |
| Anthropic (Claude) | first-class `anthropic` | Messages API | `ANTHROPIC_API_KEY`, `ANTHROPIC_EVALUATION_MODEL` | env; owner override | JSON + schema validation | same | providerId=anthropic | NO | no key |
| Google Gemini | compatible (`id: gemini`) | Gemini OpenAI-compatible chat completions, `https://generativelanguage.googleapis.com/v1beta/openai` | `AI_COMPATIBLE_PROVIDERS` entry + `AI_GEMINI_API_KEY` | entry `model`; owner override | `json_object` + schema validation | same | providerId=gemini | NO | no key |
| DeepSeek | compatible (`id: deepseek`) | `https://api.deepseek.com` chat completions | entry + `AI_DEEPSEEK_API_KEY` | entry `model`; owner override | `json_object` (prompt contains "json") | same | providerId=deepseek | NO | no key |
| Alibaba Qwen | compatible (`id: qwen`) | DashScope compatible mode, `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (pin your region's host) | entry + `AI_QWEN_API_KEY` | entry `model` (choose one with thinking off: JSON mode is not combined with thinking in non-streaming calls) | `json_object` (prompt contains "json") | same | providerId=qwen | NO | no key |
| xAI Grok | compatible (`id: grok`) | `https://api.x.ai/v1` chat completions | entry + `AI_XAI_API_KEY` | entry `model`; owner override | `json_object` + schema validation | same | providerId=grok | NO | no key |
| Groq (NOT Grok) | compatible (`id: groq`) | `https://api.groq.com/openai/v1` chat completions | entry + `AI_GROQ_API_KEY` | entry `model`; owner override | `json_object` + schema validation | same | providerId=groq | NO | no key |
| Mistral | compatible (`id: mistral`) | `https://api.mistral.ai/v1` chat completions | entry + `AI_MISTRAL_API_KEY` | entry `model`; owner override | `json_object` + schema validation | same | providerId=mistral | NO | no key |

No native adapter was added for the six compatible vendors: their documented endpoints match
the contract above, so a native adapter would be duplicate code. A vendor whose API changes
materially gets its own folder under `providers/` (see `providers/index.ts`).

Security properties pinned for every entry (PM1, PM2, PM4, PM5, PM7, PM8, UA1–UA5, UA10, UA11, UA13):
https only, no localhost/loopback/link-local/metadata/private ranges, DNS checked before every call,
`redirect: "error"`, endpoint only from deployment env (owner UI has no endpoint or key field),
learners cannot select a provider, `secretRef` is an env-var NAME, keys and error bodies never
appear in results/status/logs, model override is an identifier (never a URL),
requests carry no account id, email, Telegram id, phone or history.
Learners always see "Checked by RIWI"; the real provider/model is kept only in internal provenance.
