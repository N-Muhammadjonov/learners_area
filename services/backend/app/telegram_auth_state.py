"""Restart-safe bot auth context in the existing private draft store.

Only a token digest is retained. This context is not verification: confirm and
exchange still enforce expiry, actor binding, phone, membership and browser nonce.
One deterministic primary key per actor bounds storage and avoids an extra index.
"""
import hashlib
import json
from uuid import NAMESPACE_URL, uuid5


def context_id(actor: str):
    return uuid5(NAMESPACE_URL, 'learners-area:telegram-auth:' + actor)


async def forget(conn, actor: str):
    await conn.execute("""UPDATE telegram_flow_drafts SET consumed_at=NOW()
      WHERE id=$1 AND actor_telegram_id=$2 AND kind='auth_intent'""", context_id(actor), actor)


async def remember(conn, actor: str, token: str):
    digest = hashlib.sha256(token.encode()).hexdigest()
    # Expiry comes from the intent, never from a renewed UI session.
    return await conn.fetchval("""INSERT INTO telegram_flow_drafts
      (id,actor_telegram_id,kind,payload,expires_at)
      SELECT $1::uuid,$2::varchar,'auth_intent',jsonb_build_object('token_hash',$3::text),expires_at
      FROM telegram_login_intents WHERE token_hash=$3 AND status='pending'
        AND expires_at>NOW() AND (telegram_user_id IS NULL OR telegram_user_id=$2)
      LIMIT 1
      ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,
        expires_at=EXCLUDED.expires_at,consumed_at=NULL
      WHERE telegram_flow_drafts.actor_telegram_id=$2 AND telegram_flow_drafts.kind='auth_intent'
      RETURNING id""", context_id(actor), actor, digest)


async def token_digest(conn, actor: str, token: str):
    if token:
        return hashlib.sha256(token.encode()).hexdigest()
    row = await conn.fetchrow("""SELECT payload FROM telegram_flow_drafts
      WHERE id=$1 AND actor_telegram_id=$2 AND kind='auth_intent'
        AND consumed_at IS NULL AND expires_at>NOW()""", context_id(actor), actor)
    if not row:
        return None
    value = row['payload']
    value = json.loads(value) if isinstance(value, str) else value
    digest = value.get('token_hash') if isinstance(value, dict) else None
    return digest if isinstance(digest, str) and len(digest) == 64 else None
