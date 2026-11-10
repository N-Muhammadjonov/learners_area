"""Version 2 scope-correct portability. Native restore acceptance is separate."""
from __future__ import annotations
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib,hmac,json,os
from pathlib import Path
from typing import Literal, Final
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .riwi_outbound_guard import contains_secret_material

PortabilityMode = Literal["A", "B", "C"]
LAP1_MAGIC = b"LAP1"
PORTABILITY_MODES = ("A", "B", "C")
FORMAT = "RIWI-PORTABLE-v2"
MAX_BYTES = 16 * 1024 * 1024
MAX_ROWS = 50_000
TABLES = json.loads((Path(__file__).resolve().parents[1] / "contracts/riwi_portability_tables.json").read_text())["tables"]
NEVER_EXPORT_TABLES = frozenset(t for t,s in TABLES.items() if s["classification"] == "never")
MODE_A_TABLES = tuple(t for t in TABLES if t not in NEVER_EXPORT_TABLES)
MODE_B_TABLES = tuple(t for t,s in TABLES.items() if s["classification"] == "riwi_portable")
MODE_C_TABLES = tuple(t for t,s in TABLES.items() if s["classification"] == "site")
MODE_TABLES = {"A":frozenset(MODE_A_TABLES),"B":frozenset(MODE_B_TABLES),"C":frozenset(MODE_C_TABLES)}
SECRET_COLUMNS = frozenset({"password_hash","token_hash","browser_nonce_hash","worker_lease_token","evaluation_claim_token","evaluation_claim_expires_at","run_token_id"})
SECRET_FIELDS = frozenset({"password","password_hash","secret","api_key","apikey","access_token","refresh_token","sessiontoken","authorization","credentials","private_key"})

class RiwiPortabilityError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _resolve_signing_secret(signing_secret: str | None = None) -> bytes:
    raw = (
        signing_secret
        if isinstance(signing_secret, str) and signing_secret.strip()
        else (
            os.environ.get("RIWI_PORTABLE_SIGNING_SECRET")
            or os.environ.get("AUTH_SECRET")
            or os.environ.get("JWT_SECRET")
            or ""
        )
    ).strip()
    if len(raw) < 16:
        raise RiwiPortabilityError("signing_secret_required")
    return hmac.digest(raw.encode("utf-8"), b"riwi:portable-manifest:v2", "sha256")


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
    if not isinstance(plaintext, bytes) or len(plaintext) > MAX_BYTES:
        raise RiwiPortabilityError("archive_too_large")
    key = _decode_encryption_key(key_b64)
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, associated_data)
    return LAP1_MAGIC + nonce + ciphertext


def decrypt_lap1_envelope(envelope: bytes, key_b64: str, *, associated_data: bytes = b"RIWI-LAP1") -> bytes:
    if not isinstance(envelope, (bytes, bytearray)) or not 32 <= len(envelope) <= MAX_BYTES + 32 or not bytes(envelope).startswith(LAP1_MAGIC):
        raise RiwiPortabilityError("invalid_lap1_envelope")
    key = _decode_encryption_key(key_b64)
    nonce = bytes(envelope[4:16])
    ciphertext = bytes(envelope[16:])
    aesgcm = AESGCM(key)
    try:
        return aesgcm.decrypt(nonce, ciphertext, associated_data)
    except Exception as exc:
        raise RiwiPortabilityError("decryption_failed_or_tampered") from exc



def canonical(value):
    try:
        raw = json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
    except (TypeError,ValueError,RecursionError) as exc:
        raise RiwiPortabilityError("invalid_json_payload") from exc
    if len(raw)>MAX_BYTES: raise RiwiPortabilityError("archive_too_large")
    return raw


def safe_values(value,depth=0):
    if depth>20: raise RiwiPortabilityError("payload_too_deep")
    if isinstance(value,dict):
        if any(not isinstance(k,str) or k.lower() in SECRET_FIELDS for k in value): raise RiwiPortabilityError("secret_field_in_archive")
        for v in value.values(): safe_values(v,depth+1)
    elif isinstance(value,list):
        for v in value: safe_values(v,depth+1)
    elif isinstance(value,str) and contains_secret_material(value):
        raise RiwiPortabilityError("secret_material_in_archive")


def expired(row,now):
    if row.get("deleted_at") or row.get("state") in ("deleted","erased","expired"): return True
    if row.get("expires_at") is None: return False
    try:
        d=datetime.fromisoformat(str(row["expires_at"]).replace("Z","+00:00"))
        if d.tzinfo is None: raise ValueError()
        return d<=now
    except (TypeError,ValueError) as exc: raise RiwiPortabilityError("invalid_expiry") from exc


def filter_table_rows_for_mode(mode,table,rows,*,now=None):
    if mode not in PORTABILITY_MODES: raise RiwiPortabilityError("invalid_mode")
    if table not in TABLES: raise RiwiPortabilityError("unclassified_table")
    if not isinstance(rows,list) or len(rows)>MAX_ROWS: raise RiwiPortabilityError("invalid_table_rows")
    if table not in MODE_TABLES[mode]: return []
    out=[]; identities=set(); now=now or datetime.now(timezone.utc)
    for row in rows:
        if not isinstance(row,dict) or set(row)-set(TABLES[table]["columns"]): raise RiwiPortabilityError("unclassified_column")
        if expired(row,now): continue
        item=deepcopy(row)
        if mode=="B":
            if table=="riwi_knowledge_sources":
                if item.get("state") not in ("approved","active") or item.get("scope") not in ("global","role"): continue
                item["state"]="candidate"
            if table=="riwi_assessment_policy_versions":
                if item.get("state")!="approved": continue
                item["state"]="candidate"; item["approved_at"]=None
            if table=="riwi_assessment_policies": item["active_version"]=None
            for k in item:
                if k.endswith("_user_id") or k in ("reviewed_at","regression_passed_at"): item[k]=None
        for k in SECRET_COLUMNS: item.pop(k,None)
        safe_values(item)
        if "id" in item:
            identity=str(item["id"])
            if identity in identities: raise RiwiPortabilityError("duplicate_row_identity")
            identities.add(identity)
        out.append(item)
    return sorted(out,key=canonical)


RELATIONS=(("riwi_knowledge_units","source_id","riwi_knowledge_sources"),
           ("riwi_assessment_policy_versions","policy_id","riwi_assessment_policies"),
           ("riwi_conversation_messages","conversation_id","riwi_conversations"))


def create_portable_archive(*,mode,tables_data,encryption_key_b64=None,signing_secret=None):
    if mode not in PORTABILITY_MODES: raise RiwiPortabilityError("invalid_mode")
    key=_resolve_signing_secret(signing_secret)
    if not encryption_key_b64: raise RiwiPortabilityError("encryption_key_required")
    if not isinstance(tables_data,dict) or set(tables_data)-set(TABLES): raise RiwiPortabilityError("unclassified_table")
    now=datetime.now(timezone.utc)
    tables={t:filter_table_rows_for_mode(mode,t,rows,now=now) for t,rows in tables_data.items() if t in MODE_TABLES[mode]}
    for child,field,parent in RELATIONS:
        if child in tables:
            ids={r.get("id") for r in tables.get(parent,[])}
            tables[child]=[r for r in tables[child] if r.get(field) in ids]
    payload=canonical(tables); total=sum(map(len,tables.values()))
    if total>MAX_ROWS: raise RiwiPortabilityError("too_many_rows")
    manifest={"format":FORMAT,"classificationVersion":2,"mode":mode,"encrypted":True,"createdAt":now.isoformat(),
              "totalRows":total,"tableDigests":{t:hashlib.sha256(canonical(rows)).hexdigest() for t,rows in tables.items()},
              "payloadSha256":hashlib.sha256(payload).hexdigest()}
    manifest["signature"]=hmac.new(key,canonical(manifest),hashlib.sha256).hexdigest()
    return {"manifest":manifest,"envelopeB64":base64.b64encode(encrypt_lap1_envelope(payload,encryption_key_b64,
            associated_data=canonical(manifest))).decode()}


def import_portable_archive(archive,*,dry_run=True,encryption_key_b64=None,signing_secret=None,target_store=None):
    if not isinstance(archive,dict) or not isinstance(archive.get("manifest"),dict): raise RiwiPortabilityError("invalid_archive")
    signed=deepcopy(archive["manifest"])
    if signed.get("format")!=FORMAT: raise RiwiPortabilityError("legacy_archive_requires_explicit_migration")
    if set(archive)!={"manifest","envelopeB64"} or set(signed)!={"format","classificationVersion","mode","encrypted","createdAt","totalRows","tableDigests","payloadSha256","signature"}:
        raise RiwiPortabilityError("invalid_manifest")
    manifest=dict(signed); sig=manifest.pop("signature"); mode=manifest["mode"]
    if mode not in PORTABILITY_MODES or manifest["classificationVersion"]!=2 or manifest["encrypted"] is not True: raise RiwiPortabilityError("invalid_manifest_scope")
    expected=hmac.new(_resolve_signing_secret(signing_secret),canonical(manifest),hashlib.sha256).hexdigest()
    if not isinstance(sig,str) or not hmac.compare_digest(sig,expected): raise RiwiPortabilityError("manifest_signature_mismatch")
    try:
        encoded=archive["envelopeB64"]
        if not isinstance(encoded,str) or len(encoded)>(MAX_BYTES+32)*4//3+8: raise ValueError()
        payload=decrypt_lap1_envelope(base64.b64decode(encoded,validate=True),encryption_key_b64,associated_data=canonical(signed))
        tables=json.loads(payload)
    except (TypeError,ValueError,RecursionError) as exc:
        if isinstance(exc,RiwiPortabilityError): raise
        raise RiwiPortabilityError("invalid_encrypted_payload") from exc
    if hashlib.sha256(payload).hexdigest()!=manifest["payloadSha256"]: raise RiwiPortabilityError("payload_checksum_mismatch")
    if not isinstance(tables,dict) or not isinstance(manifest["tableDigests"],dict) or set(tables)-MODE_TABLES[mode] or set(tables)!=set(manifest["tableDigests"]):
        raise RiwiPortabilityError("forbidden_table_in_archive")
    now=datetime.now(timezone.utc); total=0
    for table,rows in tables.items():
        if not isinstance(rows,list) or len(rows)>MAX_ROWS or hashlib.sha256(canonical(rows)).hexdigest()!=manifest["tableDigests"][table]: raise RiwiPortabilityError("table_digest_mismatch")
        identities=set()
        for row in rows:
            if not isinstance(row,dict) or set(row)-set(TABLES[table]["columns"]) or set(row)&SECRET_COLUMNS: raise RiwiPortabilityError("unclassified_column")
            if expired(row,now): raise RiwiPortabilityError("expired_row_in_archive")
            safe_values(row)
            if mode=="B":
                if any(v is not None for k,v in row.items() if k.endswith("_user_id")) or row.get("state") in ("active","approved"): raise RiwiPortabilityError("private_or_active_mode_b_row")
                if table=="riwi_knowledge_sources" and row.get("scope") not in ("global","role"): raise RiwiPortabilityError("private_mode_b_scope")
                if table=="riwi_assessment_policies" and row.get("active_version") is not None: raise RiwiPortabilityError("active_mode_b_policy")
            if "id" in row:
                identity=str(row["id"])
                if identity in identities: raise RiwiPortabilityError("duplicate_row_identity")
                identities.add(identity)
        total+=len(rows)
    if total>MAX_ROWS or type(manifest["totalRows"]) is not int or total!=manifest["totalRows"]: raise RiwiPortabilityError("row_count_mismatch")
    for child,field,parent in RELATIONS:
        ids={r.get("id") for r in tables.get(parent,[])}
        if any(r.get(field) not in ids for r in tables.get(child,[])): raise RiwiPortabilityError("unresolved_portable_parent")
    if not dry_run:
        if type(target_store) is not dict: raise RiwiPortabilityError("explicit_target_adapter_required")
        for table,rows in tables.items():
            if table in target_store and target_store[table]!=rows: raise RiwiPortabilityError("destination_conflict")
        target_store.update(deepcopy(tables))
    return {"ok":True,"mode":mode,"dryRun":dry_run,"applied":not dry_run,
            "adapter":"isolated_dictionary" if target_store is not None else "validation_only",
            "validatedTables":sorted(tables),"totalRows":total}
