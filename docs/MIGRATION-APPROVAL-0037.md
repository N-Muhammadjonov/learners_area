# Profile photographs Preview migration

Prepared migration `0037_profile_photos` creates one small table keyed by the authenticated user. It stores a JPEG/PNG photograph limited to 300 KB, its MIME type and update time. Profile uploads crop to a transparent circle inside a 256 × 256 PNG; canvas conversion removes source metadata. Deleting an account cascades to its photograph. Existing accounts, roles, history and content are unchanged.

SQL SHA-256: `32890672239b62b019331a43c72d1102d48cd66651c156662c1cbad5a98f0341`.

Native PostgreSQL 18.4 isolated upgrade verification passed from the existing 0000–0036 chain: preserved account fields, rejected SVG MIME and oversized data, and removed the photograph on account deletion. Reproduce with `node scripts/qa-profile-photo-upgrade.mjs`. Receipt: `work/evidence/profile-photo-native-upgrade.json` outside Git.

The original request reserves shared Preview migrations for explicit approval. Earlier approval covered 0036 only. The owner explicitly approved applying 0037 only to Preview on 2026-10-04. The follow-up requires a Telegram-style circular crop and a remove button; the uploader now uses a circular canvas mask and stores PNG transparency. Applied to shared Preview on 2026-10-04 after a fresh native backup, isolated PostgreSQL restore, strict TLS, target-identity checks and an exact reviewed SQL hash allowlist. The apply receipt passes all 17 schema/query checks; pending migrations are empty. Post-apply preservation verified all 98 existing table counts, with only one journal entry added and the new photograph table empty. Production was untouched. Evidence: `docs/receipts/QA-backup-0037-2026-10-04.json`, `docs/receipts/preview-qa-migrate-2026-10-04T06-20-36-598Z.json`, `docs/receipts/QA-preservation-0037-2026-10-04.json`.

The photograph table is bounded database storage rather than a public R2 object. Photos are available only to approved signed-in users; suspended target accounts' photos return 404. Self-upload and deletion derive the owner from the authoritative session, never a client user ID. No image URL is public and no signed storage key is exposed.
