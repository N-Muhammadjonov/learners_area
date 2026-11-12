import aiohttp
from typing import Any, Optional

from config import config


class ApiClient:
    def __init__(self) -> None:
        self.base_url = config.INTERNAL_API_URL.rstrip("/")
        self._session: aiohttp.ClientSession | None = None

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {config.BOT_SERVICE_SECRET.get_secret_value()}",
            "Content-Type": "application/json",
        }

    async def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers=self._headers(),
                timeout=aiohttp.ClientTimeout(total=20, connect=5),
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def _request(self, method: str, path: str, *, json: Any = None, params: dict | None = None) -> tuple[int, Any]:
        session = await self.session()
        attempts = 2 if method == "GET" else 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                async with session.request(method, f"{self.base_url}{path}", json=json, params=params) as response:
                    if response.content_type == "application/json":
                        data = await response.json()
                    else:
                        data = {"error": await response.text()}
                    if method == "GET" and response.status in {502, 503, 504} and attempt + 1 < attempts:
                        continue
                    return response.status, data
            except Exception as exc:
                last_error = exc
                if attempt + 1 >= attempts:
                    raise
        if last_error:
            raise last_error
        raise RuntimeError("request failed")

    @staticmethod
    def _require_worker_success(status: int, data: Any, action: str) -> None:
        """Expose only a trusted action and HTTP code; never log message bodies or credentials."""
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(f"Telegram worker {action} failed: HTTP {status}")

    async def get_user(self, telegram_user_id: str) -> Optional[dict[str, Any]]:
        status, data = await self._request("GET", f"/users/{telegram_user_id}")
        if status == 200:
            return data
        if status == 404:
            return None
        raise RuntimeError(f"user lookup failed: {status}")

    async def sync_contact(self, payload: dict[str, Any]) -> None:
        await self._request("POST", "/contacts", json=payload)

    async def save_verified_phone(self, telegram_user_id: str, contact_user_id: str, phone: str) -> bool:
        status, data = await self._request("POST", "/contacts/phone", json={
            "telegramUserId": telegram_user_id,
            "contactUserId": contact_user_id,
            "phoneNumber": phone,
        })
        return status == 200 and bool(data.get("ok"))

    async def required_channels(self, actor_id: str) -> tuple[int, Any]:
        return await self._request(
            "GET", "/required-channels", params={"actorTelegramId": actor_id}
        )

    async def change_required_channels(self, actor_id: str, action: str, channel: dict) -> tuple[int, Any]:
        return await self._request("POST", "/required-channels", json={
            "actorTelegramId": actor_id, "action": action, "channel": channel,
        })

    async def owner_contact_detail(self, actor_id: str, target_id: str) -> tuple[int, Any]:
        return await self._request(
            "GET", f"/contacts/{target_id}", params={"actorTelegramId": actor_id}
        )

    async def create_login_handoff(self, telegram_user_id: str) -> tuple[int, Any]:
        return await self._request("POST", "/auth/handoff", json={
            "telegramUserId": telegram_user_id,
        })

    async def confirm_intent(self, token: str, telegram_user_id: str, **extra: Any) -> bool:
        status, _data = await self._request(
            "POST",
            "/auth/confirm",
            json={"token": token, "telegramUserId": telegram_user_id, **extra},
        )
        return status == 200

    async def preflight_intent(self, token: str, telegram_user_id: str) -> tuple[int, Any]:
        return await self._request("POST", "/auth/preflight",
            json={"token": token, "telegramUserId": telegram_user_id})

    async def auth_context(self, actor: str, token: str = "", *, cancel: bool = False) -> tuple[int, Any]:
        return await self._request("POST", "/auth/preflight", json={
            "telegramUserId": actor, "token": token, "action": "cancel" if cancel else "begin",
        })

    async def create_access_request(self, telegram_user_id: str, name: str, message: str | None = None, **extra: Any) -> Any:
        payload = {"telegramUserId": telegram_user_id, "name": name, "message": message, **extra}
        status, data = await self._request("POST", "/admission/request", json=payload)
        if status in {200, 403, 409, 503} and isinstance(data, dict):
            return data
        raise RuntimeError(f"admission request failed: {status}")

    async def ready(self) -> bool:
        status, data = await self._request("GET", "/ready")
        return status == 200 and bool(data.get("ok"))

    async def save_draft(self, actor: str, kind: str, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", "/drafts", json={"action": "create", "actorTelegramId": actor, "kind": kind, "payload": payload})

    async def update_draft(self, actor: str, draft_id: str, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", "/drafts", json={"action": "update", "actorTelegramId": actor, "id": draft_id, "payload": payload})

    async def read_draft(self, actor: str, draft_id: str) -> tuple[int, Any]:
        return await self._request("POST", "/drafts", json={"action": "read", "actorTelegramId": actor, "id": draft_id})

    async def claim_draft(self, actor: str, draft_id: str, kind: str | None = None) -> tuple[int, Any]:
        body: dict[str, Any] = {"action": "claim", "actorTelegramId": actor, "id": draft_id}
        if kind:
            body["kind"] = kind
        return await self._request("POST", "/drafts", json=body)

    async def list_pending_requests(self, actor_telegram_id: str, page: int = 1) -> list:
        status, data = await self._request("GET", "/admission/pending", params={"actorTelegramId": actor_telegram_id, "page": page})
        if status == 200:
            return data.get("requests", [])
        if status in {401, 403}:
            return []
        raise RuntimeError(f"pending list failed: {status}")

    async def decide_access_request(self, actor_telegram_id: str, request_id: str, decision: str, note: str | None = None) -> bool:
        status, _data = await self._request(
            "POST",
            "/admission/decide",
            json={"actorTelegramId": actor_telegram_id, "requestId": request_id, "decision": decision, "note": note},
        )
        return status == 200

    async def claim_update(self, update_id: int) -> bool | None:
        try:
            status, data = await self._request("POST", "/updates", json={"updateId": str(update_id)})
        except Exception:
            return None
        if status != 200:
            return None
        return bool(data.get("fresh"))

    async def open_support(self, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", "/support/threads", json=payload)

    async def list_support(self, actor: str, filter_name: str, page: int = 1) -> tuple[int, Any]:
        return await self._request(
            "GET",
            "/support/threads",
            params={"actorTelegramId": actor, "filter": filter_name, "page": page},
        )

    async def support_detail(self, actor: str, thread_id: str) -> tuple[int, Any]:
        return await self._request("GET", f"/support/threads/{thread_id}", params={"actorTelegramId": actor})

    async def support_reply(self, thread_id: str, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", f"/support/threads/{thread_id}/messages", json=payload)

    async def support_action(self, thread_id: str, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", f"/support/threads/{thread_id}/actions", json=payload)

    async def search_users(self, actor: str, q: str = "", page: int = 1, status: str = "", role: str = "") -> tuple[int, Any]:
        return await self._request(
            "GET",
            "/directory",
            params={"actorTelegramId": actor, "q": q, "page": page, "status": status, "role": role},
        )

    async def search_parents(self, actor: str, q: str = "", page: int = 1) -> tuple[int, Any]:
        return await self._request("GET", "/parents", params={"actorTelegramId": actor, "q": q, "page": page})

    async def parent_detail(self, actor: str, profile_id: str) -> tuple[int, Any]:
        return await self._request("GET", f"/parents/{profile_id}", params={"actorTelegramId": actor})

    async def student_parents(self, actor: str, user_id: str) -> tuple[int, Any]:
        return await self._request("GET", f"/directory/{user_id}/parents", params={"actorTelegramId": actor})

    async def remove_contact(self, actor: str, telegram_id: str) -> tuple[int, Any]:
        return await self._request("POST", f"/contacts/{telegram_id}/remove", json={"actorTelegramId": actor})

    async def user_detail(self, actor: str, user_id: str) -> tuple[int, Any]:
        return await self._request("GET", f"/directory/{user_id}", params={"actorTelegramId": actor})

    async def user_action(self, user_id: str, path: str, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", f"/directory/{user_id}/{path}", json=payload)

    async def admins(self, actor: str) -> tuple[int, Any]:
        return await self._request("GET", "/admins", params={"actorTelegramId": actor})

    async def add_admin(self, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", "/admins", json=payload)

    async def patch_admin(self, telegram_user_id: str, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("PATCH", f"/admins/{telegram_user_id}", json=payload)

    async def broadcast(self, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("POST", "/broadcasts", json=payload)

    async def broadcast_status(self, actor: str, broadcast_id: str) -> tuple[int, Any]:
        return await self._request("GET", f"/broadcasts/{broadcast_id}", params={"actorTelegramId": actor})

    async def cancel_broadcast(self, broadcast_id: str, actor: str) -> tuple[int, Any]:
        return await self._request("POST", f"/broadcasts/{broadcast_id}", json={"actorTelegramId": actor, "action": "cancel"})

    async def claim_broadcasts(self) -> list[dict[str, Any]]:
        status, data = await self._request("POST", "/broadcasts/claim", json={"limit": 15})
        self._require_worker_success(status, data, "broadcasts claim")
        return data.get("deliveries", [])

    async def report_broadcasts(self, results: list[dict[str, Any]]) -> None:
        status, data = await self._request("POST", "/broadcasts/claim", json={"results": results})
        self._require_worker_success(status, data, "broadcasts report")

    async def notification_prefs(self, actor: str) -> tuple[int, Any]:
        return await self._request("GET", "/notifications", params={"actorTelegramId": actor})

    async def save_notification_prefs(self, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("PUT", "/notifications", json=payload)

    async def claim_notices(self) -> list[dict[str, Any]]:
        status, data = await self._request("POST", "/notifications", json={"limit": 15})
        self._require_worker_success(status, data, "notifications claim")
        return data.get("notices", [])

    async def report_notices(self, results: list[dict[str, Any]]) -> None:
        status, data = await self._request("POST", "/notifications", json={"results": results})
        self._require_worker_success(status, data, "notifications report")

    async def ops(self, actor: str, view: str, page: int = 1) -> tuple[int, Any]:
        return await self._request("GET", "/ops", params={"actorTelegramId": actor, "view": view, "page": page})

    async def save_setting(self, payload: dict[str, Any]) -> tuple[int, Any]:
        return await self._request("PATCH", "/ops", json=payload)

    async def owner_summary(self, actor: str) -> tuple[int, Any]:
        return await self._request("GET", "/owner", params={"actorTelegramId": actor})

    async def start_owner_handover(self, actor: str, target_telegram_id: str) -> tuple[int, Any]:
        return await self._request(
            "POST",
            "/owner/handover",
            json={"action": "start", "actorTelegramId": actor, "targetTelegramId": target_telegram_id},
        )

    async def decide_owner_handover(self, actor: str, handover_id: str, step: str) -> tuple[int, Any]:
        return await self._request(
            "POST",
            "/owner/handover",
            json={"action": step, "actorTelegramId": actor, "handoverId": handover_id},
        )

    async def decide_website_transfer(self, actor: str, challenge_id: str, decision: str) -> tuple[int, Any]:
        return await self._request(
            "POST",
            "/owner/transfer",
            json={"actorTelegramId": actor, "challengeId": challenge_id, "decision": decision},
        )

    # ── Parent Connect ──────────────────────────────────────────────
    async def guardian_invite(self, telegram_user_id: str, relationship: str | None = None) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/invitations", json={"telegramUserId": telegram_user_id, "relationship": relationship})

    async def guardian_student_links(self, telegram_user_id: str) -> tuple[int, Any]:
        return await self._request("GET", "/guardians/student-links", params={"telegramUserId": telegram_user_id})

    async def guardian_decide(self, actor: str, link_id: str, decision: str) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/decide", json={"actorTelegramId": actor, "linkId": link_id, "decision": decision})

    async def guardian_redeem(self, telegram_user_id: str, token: str, display_name: str, language: str) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/redeem", json={
            "telegramUserId": telegram_user_id, "token": token, "displayName": display_name, "languageCode": language})

    async def guardian_state(self, telegram_user_id: str) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/state", json={"telegramUserId": telegram_user_id})

    async def guardian_relationship(self, telegram_user_id: str, link_id: str, relationship: str) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/relationship", json={
            "telegramUserId": telegram_user_id, "linkId": link_id, "relationship": relationship})

    async def guardian_check_channel(self, telegram_user_id: str, link_id: str) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/check-channel", json={"telegramUserId": telegram_user_id, "linkId": link_id})

    async def submit_guardian_reply(self, actor: str, delivery_id: str, message_id: str, text: str) -> tuple[int, Any]:
        return await self._request("POST", "/guardians/replies", json={
            "actorTelegramId": actor, "deliveryId": delivery_id,
            "incomingMessageId": message_id, "text": text,
        })

    async def claim_guardian_replies(self) -> list[dict[str, Any]]:
        status, data = await self._request("POST", "/guardians/replies/claim", json={"limit": 10})
        self._require_worker_success(status, data, "guardian replies claim")
        return data.get("replies", [])

    async def report_guardian_replies(self, results: list[dict[str, Any]]) -> None:
        status, data = await self._request("POST", "/guardians/replies/claim", json={"results": results})
        self._require_worker_success(status, data, "guardian replies report")

    async def send_contact_message(self, actor: str, telegram_id: str, text: str) -> tuple[int, Any]:
        return await self._request("POST", f"/contacts/{telegram_id}/message", json={
            "actorTelegramId": actor, "text": text,
        })

    async def claim_guardian_deliveries(self) -> list[dict[str, Any]]:
        status, data = await self._request("POST", "/guardians/deliveries/claim", json={"limit": 10})
        self._require_worker_success(status, data, "guardian messages claim")
        return data.get("deliveries", [])

    async def report_guardian_deliveries(self, results: list[dict[str, Any]]) -> None:
        status, data = await self._request("POST", "/guardians/deliveries/claim", json={"results": results})
        self._require_worker_success(status, data, "guardian messages report")


api_client = ApiClient()
