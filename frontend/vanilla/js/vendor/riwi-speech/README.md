# Local dictation assets

Transformers.js 3.8.1 and its matching ONNX Runtime Web build run the pinned
multilingual Whisper Base Q8 speech-recognition model in a dedicated browser
worker. This is speech-to-text only; RIWI chat generation remains rule-based.

`manifest.json` records original revisions, URLs, bytes and SHA-256 hashes.
Apache-2.0 model/conversion terms, upstream MIT terms and runtime licences are
stored alongside the assets. Refresh with `scripts/riwi-speech-assets.py` using
the pinned package. The script reuses verified downloaded weights and does not
silently change an existing model revision.

Binary assets total 101,260,210 bytes. They are served in 2 MiB chunks to fit the
existing function response budget. The worker verifies each chunk and assembled
asset, disallows remote models, sets one WASM thread, and rejects any non-GET or
off-origin fetch. Only public model/runtime bytes are fetched. No audio, speech
transcript or microphone blob is transmitted during dictation to a browser
vendor, provider or RIWI API. Only if the user presses Send does the editable
text become an ordinary RIWI prompt. Audio is transferred to the local worker
and discarded afterwards.

Assets load only after microphone use and can use the ordinary immutable HTTP
cache. First use needs a sizeable model download. Recording uses the existing
Speaking recorder; stopping inserts editable text in the composer and never
submits it. Language can be auto-detected or selected as Uzbek/English. Accuracy
varies with language, pronunciation and noise; the user reviews the text before
sending. Silence and invalid/oversized audio fail explicitly. Route exit cancels
capture and terminates the worker; there is no cloud speech fallback.
