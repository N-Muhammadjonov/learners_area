from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from typing import Any, Final, Literal

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PortabilityMode = Literal["A", "B", "C"]

LAP1_MAGIC: Final[bytes] = b"LAP1"
PORTABILITY_MODES: Final[tuple[str, ...]] = ("A", "B", "C")

# Closed table classification
MODE_A_TABLES: Final[tuple[str, ...]] = (
    "dictionary_entries",
    "grammar_topics",
    "course_lessons",
    "riwi_knowledge_sources",
    "riwi_knowledge_units",
    "riwi_assessment_policies",
    "riwi_assessment_policy_versions",
)

MODE_B_EXTRA_TABLES: Final[tuple[str, ...]] = (
    "riwi_learning_signals",
    "riwi_learning_reviews",
    "riwi_security_signals",
    "riwi_provider_experiments",
    "riwi_provider_experiment_results",
    "riwi_usage_metrics",
)

MODE_C_EXTRA_TABLES: Final[tuple[str, ...]] = (
    "users",
    "teacher_student_links",
    "evaluations",
    "coach_weaknesses",
    "retention_attempts",
    "riwi_conversations",
    "riwi_conversation_messages",
    "speaking_ai_sessions",
    "speaking_ai_session_items",
    "audit_log",
)

NEVER_EXPORT_TABLES: Final[frozenset[str]] = frozenset({
    "riwi_action_confirmations",
    "auth_sessions",
    "password_reset_tokens",
    "shared_abuse_limits",
})


class RiwiPortabilityError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _decode_encryption_key(key_b64: str | None) -> bytes:
    if not key_b64 or not isinstance(key_b64, str):
        raise RiwiPortabilityError("encryption_key_required")
    try:
        raw = base64.b64decode(key_b64.strip(), validate=True)
    except Exception as exc:
        raise RiwiPortabilityError("invalid_encryption_key") from exc
    if len(raw) != 32:
        raise RiwiPortabilityError("invalid_encryption_key_length")
    return raw


def encrypt_lap1_envelope(plaintext: bytes, key_b64: str, *, associated_data: bytes = b"RIWI-LAP1") -> bytes:
    key = _decode_encryption_key(key_b64)
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, associated_data)
    return LAP1_MAGIC + nonce + ciphertext


def decrypt_lap1_envelope(envelope: bytes, key_b64: str, *, associated_data: bytes = b"RIWI-LAP1") -> bytes:
    if not isinstance(envelope, (bytes, bytearray)) or len(envelope) < 32 or not bytes(envelope).startswith(LAP1_MAGIC):
        raise RiwiPortabilityError("invalid_lap1_envelope")
    key = _decode_encryption_key(key_b64)
    nonce = bytes(envelope[4:16])
    ciphertext = bytes(envelope[16:])
    aesgcm = AESGCM(key)
    try:
        return aesgcm.decrypt(nonce, ciphertext, associated_data)
    except Exception as exc:
        raise RiwiPortabilityError("decryption_failed_or_tampered") from exc


def filter_table_rows_for_mode(mode: PortabilityMode, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if mode not in PORTABILITY_MODES:
        raise RiwiPortabilityError("invalid_mode")
    if table in NEVER_EXPORT_TABLES:
        return []

    allowed_tables = set(MODE_A_TABLES)
    if mode in ("B", "C"):
        allowed_tables.update(MODE_B_EXTRA_TABLES)
    if mode == "C":
        allowed_tables.update(MODE_C_EXTRA_TABLES)
    if table not in allowed_tables:
        return []

    filtered: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        if mode in ("A", "B"):
            if table == "riwi_knowledge_sources" and item.get("state") not in ("approved", "active"):
                continue
            if table == "riwi_knowledge_sources" and item.get("scope") == "user":
                continue
            if table == "riwi_assessment_policy_versions" and item.get("state") != "approved":
                continue
            # Strip user identifiers in Mode A/B
            for pii_col in ("created_by_user_id", "approved_by_user_id", "actor_user_id", "target_user_id", "scope_user_id"):
                if pii_col in item:
                    item[pii_col] = None
        if mode == "C" and table == "users":
            # Never export password hashes even in Mode C
            item.pop("password_hash", None)
        filtered.append(item)
    return filtered


def create_portable_archive(
    *,
    mode: PortabilityMode,
    tables_data: dict[str, list[dict[str, Any]]],
    encryption_key_b64: str | None = None,
    signing_secret: str = "riwi-portable-manifest-secret-v1",
) -> dict[str, Any]:
    if mode not in PORTABILITY_MODES:
        raise RiwiPortabilityError("invalid_mode")
    if mode == "C" and not encryption_key_b64:
        raise RiwiPortabilityError("mode_c_requires_encryption_key")

    exported_tables: dict[str, list[dict[str, Any]]] = {}
    table_digests: dict[str, str] = {}
    total_rows = 0

    for table in sorted(tables_data.keys()):
        if table in NEVER_EXPORT_TABLES:
            continue
        clean_rows = filter_table_rows_for_mode(mode, table, tables_data[table])
        if clean_rows or table in MODE_A_TABLES:
            exported_tables[table] = clean_rows
            canonical_bytes = json.dumps(clean_rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
            table_digests[table] = hashlib.sha256(canonical_bytes).hexdigest()
            total_rows += len(clean_rows)

    payload_bytes = json.dumps(exported_tables, sort_keys=True, separators=(",", ":")).encode("utf-8")
    payload_sha256 = hashlib.sha256(payload_bytes).hexdigest()

    manifest = {
        "format": "RIWI-PORTABLE-v1",
        "mode": mode,
        "encrypted": bool(encryption_key_b64),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "totalRows": total_rows,
        "tableDigests": table_digests,
        "payloadSha256": payload_sha256,
    }
    manifest_canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    manifest["signature"] = hmac.new(signing_secret.encode("utf-8"), manifest_canonical, hashlib.sha256).hexdigest()

    if encryption_key_b64:
        envelope = encrypt_lap1_envelope(payload_bytes, encryption_key_b64)
        return {
            "manifest": manifest,
            "envelopeB64": base64.b64encode(envelope).decode("ascii"),
        }
    return {
        "manifest": manifest,
        "tables": exported_tables,
    }


def import_portable_archive(
    archive: dict[str, Any],
    *,
    dry_run: bool = True,
    encryption_key_b64: str | None = None,
    signing_secret: str = "riwi-portable-manifest-secret-v1",
    target_store: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    if not isinstance(archive, dict) or not isinstance(archive.get("manifest"), dict):
        raise RiwiPortabilityError("invalid_archive")
    manifest = dict(archive["manifest"])
    sig = manifest.pop("signature", None)
    if not isinstance(sig, str):
        raise RiwiPortabilityError("missing_manifest_signature")

    manifest_canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    expected_sig = hmac.new(signing_secret.encode("utf-8"), manifest_canonical, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise RiwiPortabilityError("manifest_signature_mismatch")

    if manifest.get("encrypted"):
        env_b64 = archive.get("envelopeB64")
        if not isinstance(env_b64, str):
            raise RiwiPortabilityError("missing_encrypted_envelope")
        raw_envelope = base64.b64decode(env_b64.encode("ascii"))
        payload_bytes = decrypt_lap1_envelope(raw_envelope, encryption_key_b64 or "")
        tables = json.loads(payload_bytes.decode("utf-8"))
    else:
        if manifest.get("mode") == "C":
            raise RiwiPortabilityError("unencrypted_mode_c_forbidden")
        tables = archive.get("tables")
        if not isinstance(tables, dict):
            raise RiwiPortabilityError("missing_tables_payload")
        payload_bytes = json.dumps(tables, sort_keys=True, separators=(",", ":")).encode("utf-8")

    actual_sha = hashlib.sha256(payload_bytes).hexdigest()
    if actual_sha != manifest.get("payloadSha256"):
        raise RiwiPortabilityError("payload_checksum_mismatch")

    for tbl, rows in tables.items():
        if tbl in NEVER_EXPORT_TABLES:
            raise RiwiPortabilityError("forbidden_table_in_archive")
        digest = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        if digest != manifest.get("tableDigests", {}).get(tbl):
            raise RiwiPortabilityError(f"table_digest_mismatch:{tbl}")

    applied = False
    if not dry_run and target_store is not None:
        for tbl, rows in tables.items():
            target_store[tbl] = [dict(r) for r in rows]
        applied = True

    return {
        "ok": True,
        "mode": manifest["mode"],
        "dryRun": dry_run,
        "applied": applied,
        "validatedTables": sorted(tables.keys()),
        "totalRows": int(manifest.get("totalRows") or 0),
    }
