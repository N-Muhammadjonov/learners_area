import sys, os
# Ensure the bot package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from aiogram.types import Message, User, Chat, CallbackQuery, InlineKeyboardMarkup
from handlers.admission import admission_router, cmd_apply, cmd_pending, handle_decision


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_user(user_id: int = 12345, first_name: str = "Test", last_name: str = "User"):
    return User(id=user_id, is_bot=False, first_name=first_name, last_name=last_name)


def make_message(user_id: int = 12345, text: str = "/apply") -> MagicMock:
    msg = MagicMock(spec=Message)
    msg.from_user = make_user(user_id)
    msg.text = text
    msg.answer = AsyncMock()
    msg.chat = Chat(id=user_id, type="private")
    return msg


def make_callback(user_id: int = 12345, data: str = "decide_approve_req123") -> MagicMock:
    cb = MagicMock(spec=CallbackQuery)
    cb.from_user = make_user(user_id)
    cb.data = data
    cb.answer = AsyncMock()
    cb.message = MagicMock(spec=Message)
    cb.message.text = "👤 Ism: Test\n📧 Email: —"
    cb.message.edit_text = AsyncMock()
    return cb


# ---------------------------------------------------------------------------
# /apply tests
# ---------------------------------------------------------------------------

class TestApply:
    @pytest.mark.asyncio
    async def test_apply_new_user(self):
        """New unlinked user requests access → PENDING."""
        msg = make_message()
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.create_access_request = AsyncMock(return_value="req-abc")
            await cmd_apply(msg, db_user=None)
        msg.answer.assert_called_once()
        text = msg.answer.call_args[0][0]
        assert "qabul qilindi" in text.lower() or "✅" in text

    @pytest.mark.asyncio
    async def test_apply_already_active(self):
        """Active user cannot re-apply."""
        msg = make_message()
        db_user = {"accountStatus": "active", "role": "student"}
        await cmd_apply(msg, db_user=db_user)
        msg.answer.assert_called_once()
        text = msg.answer.call_args[0][0]
        assert "tasdiqlangan" in text.lower()

    @pytest.mark.asyncio
    async def test_apply_already_pending(self):
        """Pending user told to wait."""
        msg = make_message()
        db_user = {"accountStatus": "pending", "role": "student"}
        await cmd_apply(msg, db_user=db_user)
        text = msg.answer.call_args[0][0]
        assert "kuting" in text.lower()

    @pytest.mark.asyncio
    async def test_apply_suspended_user(self):
        """Suspended user told to contact admin."""
        msg = make_message()
        db_user = {"accountStatus": "suspended", "role": "student"}
        await cmd_apply(msg, db_user=db_user)
        text = msg.answer.call_args[0][0]
        assert "to'xtatilgan" in text.lower()

    @pytest.mark.asyncio
    async def test_apply_api_error(self):
        """API failure gives user a clean error."""
        msg = make_message()
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.create_access_request = AsyncMock(side_effect=Exception("timeout"))
            await cmd_apply(msg, db_user=None)
        text = msg.answer.call_args[0][0]
        assert "xatolik" in text.lower() or "❌" in text

    @pytest.mark.asyncio
    async def test_apply_uses_numeric_telegram_id(self):
        """Admission request uses numeric Telegram ID, not username."""
        msg = make_message(user_id=99887766)
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.create_access_request = AsyncMock(return_value="req-xyz")
            await cmd_apply(msg, db_user=None)
        call_args = mock_api.create_access_request.call_args
        assert call_args[0][0] == "99887766"  # numeric, stringified


# ---------------------------------------------------------------------------
# /pending tests
# ---------------------------------------------------------------------------

class TestPending:
    @pytest.mark.asyncio
    async def test_pending_unauthorized_student(self):
        """Student cannot list pending requests."""
        msg = make_message()
        db_user = {"role": "student", "accountStatus": "active"}
        await cmd_pending(msg, db_user=db_user)
        text = msg.answer.call_args[0][0]
        assert "ruxsat" in text.lower()

    @pytest.mark.asyncio
    async def test_pending_unauthorized_none(self):
        """Unlinked user cannot list pending."""
        msg = make_message()
        await cmd_pending(msg, db_user=None)
        text = msg.answer.call_args[0][0]
        assert "ruxsat" in text.lower()

    @pytest.mark.asyncio
    async def test_pending_owner_sees_list(self):
        """OWNER sees pending requests."""
        msg = make_message()
        db_user = {"role": "owner", "accountStatus": "active"}
        pending = [
            {"id": "r1", "applicantName": "Ali", "applicantEmail": None,
             "message": "Kirgim keladi", "createdAt": "2025-01-01T00:00:00Z"}
        ]
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.list_pending_requests = AsyncMock(return_value=pending)
            await cmd_pending(msg, db_user=db_user)
        assert msg.answer.call_count == 1
        text = msg.answer.call_args[0][0]
        assert "Ali" in text

    @pytest.mark.asyncio
    async def test_pending_empty(self):
        """OWNER sees empty message when no pending."""
        msg = make_message()
        db_user = {"role": "owner", "accountStatus": "active"}
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.list_pending_requests = AsyncMock(return_value=[])
            await cmd_pending(msg, db_user=db_user)
        text = msg.answer.call_args[0][0]
        assert "yo'q" in text.lower()


# ---------------------------------------------------------------------------
# Decide (approve / reject) tests
# ---------------------------------------------------------------------------

class TestDecision:
    @pytest.mark.asyncio
    async def test_approve_by_owner(self):
        """OWNER approves successfully."""
        cb = make_callback(data="decide_approve_req123")
        db_user = {"role": "owner", "accountStatus": "active"}
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.decide_access_request = AsyncMock(return_value=True)
            await handle_decision(cb, db_user=db_user)
        cb.message.edit_text.assert_called_once()
        text = cb.message.edit_text.call_args[0][0]
        assert "Tasdiqlandi" in text

    @pytest.mark.asyncio
    async def test_reject_by_admin(self):
        """Admin rejects successfully."""
        cb = make_callback(data="decide_reject_req456")
        db_user = {"role": "admin", "accountStatus": "active"}
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.decide_access_request = AsyncMock(return_value=True)
            await handle_decision(cb, db_user=db_user)
        text = cb.message.edit_text.call_args[0][0]
        assert "Rad etildi" in text

    @pytest.mark.asyncio
    async def test_student_cannot_approve(self):
        """Student pressing approve button is denied."""
        cb = make_callback(data="decide_approve_req123")
        db_user = {"role": "student", "accountStatus": "active"}
        await handle_decision(cb, db_user=db_user)
        cb.answer.assert_called_once()
        text = cb.answer.call_args[0][0]
        assert "ruxsat" in text.lower()

    @pytest.mark.asyncio
    async def test_unlinked_user_cannot_approve(self):
        """Unlinked user pressing approve button is denied."""
        cb = make_callback(data="decide_approve_req123")
        await handle_decision(cb, db_user=None)
        cb.answer.assert_called_once()
        text = cb.answer.call_args[0][0]
        assert "ruxsat" in text.lower()

    @pytest.mark.asyncio
    async def test_teacher_cannot_approve(self):
        """Teacher has no admission authority."""
        cb = make_callback(data="decide_approve_req123")
        db_user = {"role": "teacher", "accountStatus": "active"}
        await handle_decision(cb, db_user=db_user)
        cb.answer.assert_called_once()
        text = cb.answer.call_args[0][0]
        assert "ruxsat" in text.lower()

    @pytest.mark.asyncio
    async def test_double_approve_returns_conflict(self):
        """Double approve is handled safely — server returns false."""
        cb = make_callback(data="decide_approve_req123")
        db_user = {"role": "owner", "accountStatus": "active"}
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.decide_access_request = AsyncMock(return_value=False)
            await handle_decision(cb, db_user=db_user)
        cb.answer.assert_called_once()
        text = cb.answer.call_args[0][0]
        assert "allaqachon" in text.lower() or "topilmadi" in text.lower()

    @pytest.mark.asyncio
    async def test_invalid_callback_format(self):
        """Malformed callback data handled gracefully."""
        cb = make_callback(data="decide_")
        db_user = {"role": "owner", "accountStatus": "active"}
        await handle_decision(cb, db_user=db_user)
        cb.answer.assert_called_once()

    @pytest.mark.asyncio
    async def test_invalid_decision_type(self):
        """Unknown decision type denied."""
        cb = make_callback(data="decide_delete_req123")
        db_user = {"role": "owner", "accountStatus": "active"}
        await handle_decision(cb, db_user=db_user)
        cb.answer.assert_called_once()
        text = cb.answer.call_args[0][0]
        assert "noto'g'ri" in text.lower().replace("ʻ", "'")

    @pytest.mark.asyncio
    async def test_decide_uses_numeric_telegram_id(self):
        """Decision passes numeric Telegram ID to server."""
        cb = make_callback(user_id=55443322, data="decide_approve_req789")
        db_user = {"role": "owner", "accountStatus": "active"}
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.decide_access_request = AsyncMock(return_value=True)
            await handle_decision(cb, db_user=db_user)
        call_args = mock_api.decide_access_request.call_args
        assert call_args[0][0] == "55443322"

    @pytest.mark.asyncio
    async def test_server_error_during_decide(self):
        """Server exception is handled gracefully."""
        cb = make_callback(data="decide_approve_req123")
        db_user = {"role": "owner", "accountStatus": "active"}
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.decide_access_request = AsyncMock(side_effect=Exception("500"))
            await handle_decision(cb, db_user=db_user)
        cb.answer.assert_called_once()
        text = cb.answer.call_args[0][0]
        assert "xatoligi" in text.lower() or "server" in text.lower()


# ---------------------------------------------------------------------------
# Server-side admission security (TypeScript internal API tests would be
# separate; here we verify the bot layer does NOT skip role checks)
# ---------------------------------------------------------------------------

class TestNoFakeEmail:
    """Verify the bot never fabricates an email address."""

    @pytest.mark.asyncio
    async def test_apply_payload_has_no_email(self):
        """create_access_request payload must NOT contain a fake email."""
        msg = make_message(user_id=111222333)
        with patch("handlers.admission.api_client") as mock_api:
            mock_api.create_access_request = AsyncMock(return_value="r1")
            await cmd_apply(msg, db_user=None)
        call_args = mock_api.create_access_request.call_args
        # The method signature is (telegram_user_id, name, message)
        # There is no email argument at all.
        assert len(call_args[0]) == 3
        for arg in call_args[0]:
            if isinstance(arg, str):
                assert "@" not in arg or "fake" not in arg.lower()
