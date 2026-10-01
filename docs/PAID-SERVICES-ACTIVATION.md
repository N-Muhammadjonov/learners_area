# Services prepared for owner activation

No paid resources have been created and no real vendor calls were made during this change.
Start on Preview. Secrets stay in Vercel server environment variables, never Git or NEXT_PUBLIC.

## OpenAI evaluation and speech-to-text

1. Set OPENAI_API_KEY. Choose an account-supported Responses model with JSON object output and set OPENAI_EVALUATION_MODEL; choose a transcription model and set OPENAI_STT_MODEL.
2. Evaluation: AI_PRIMARY_PROVIDER=openai, AI_EXTERNAL_ENABLED=true. Transcription separately: STT_PRIMARY_PROVIDER=openai. Defaults remain RIWI / none.
3. Redeploy. Submit one QA writing answer and one owned QA speaking recording. Confirm actual provider labels, stored estimates and no invented pronunciation. Failures fall back to RIWI for evaluation; transcription reports a real failure and never fabricates a transcript.
4. Set vendor project spending limits and review privacy/retention settings before sharing real learner work. Requests use only task content and language; Responses requests set store:false. Vendor processing policy still applies.
5. Set AI_EXTERNAL_ENABLED=false to stop both external evaluation and transcription.

Official contracts used: https://developers.openai.com/api/docs/guides/migrate-to-responses and https://developers.openai.com/api/docs/guides/speech-to-text . No client SDK or new runtime package required.

## Google sign-in

Create a Google OAuth web client. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to the exact deployed /api/auth/google/callback URL. Authorize that redirect and the app origin in Google Console. Apply the checked QA migration adding google_sub first. Redeploy and verify consent, state rejection, duplicate callbacks and existing-account linking on QA accounts. Configuring secrets alone is not browser verification.

## Live Partner

Build services/live-signal/Dockerfile on an always-on container host. Run one instance behind HTTPS with WebSocket upgrades. Set ALLOWED_ORIGINS to comma-separated exact Learners Area origins and LIVE_PARTNER_SIGNAL_SECRET to a generated secret of at least 32 characters. The app uses the same secret and LIVE_PARTNER_SIGNAL_URL=wss://your-host/signal. The /healthz response must identify learners-area-live-signal.

Use a coturn-compatible REST-credential relay (see services/live-signal/README.md). Set LIVE_PARTNER_TURN_URLS and LIVE_PARTNER_TURN_SECRET on the app server. Do not put permanent relay secrets in the browser. This adapter supports the coturn HMAC REST credential contract, not arbitrary vendor API keys. A vendor offering a different contract needs its own adapter.

Allow relay UDP/TCP/TLS ports on the host; provision TLS certificates. Test two separate QA users on different networks: microphone consent, invite/accept, both-way audio, reconnect, end, disappearance, blocked user, Practice conflict. Audio is relay-only and not stored by the signalling service. Health success is not proof that TURN or two-way audio works.

## Database and release gates

Use scripts/preview-qa-migrate.mjs --fingerprint, --plan, then --apply with an actual backup reference against the owner-confirmed QA database. Never substitute Production. Keep backup evidence and migration receipt. Real PostgreSQL race tests require an isolated QA2 database; PGlite UI fixtures do not certify concurrent network clients.

External credentials, real audio, real OAuth, database backup/migration and deployment/browser acceptance remain separate gates. None is marked passed just because these files build.
