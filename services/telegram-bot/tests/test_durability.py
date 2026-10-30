"""No Telegram/network calls: lost memory, duplicate delivery and outage retry."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.web import HTTPServiceUnavailable
from aiogram.filters.command import CommandObject
from aiogram.types import Update
from handlers.auth import cmd_start, cmd_cancel, _complete_pending_intent
from middlewares.auth import DedupMiddleware, _SEEN
from test_phone_and_channels import message_with_contact


@pytest.mark.asyncio
async def test_webhook_secret_and_outage_response_are_not_background_acknowledged(monkeypatch):
    from aiogram import Bot
    import bot as service
    from pydantic import SecretStr
    monkeypatch.setattr(service.config, 'WEBHOOK_SECRET', SecretStr('fixture-secret'))
    dispatcher = MagicMock()
    dispatcher.feed_webhook_update = AsyncMock(side_effect=HTTPServiceUnavailable(text='temporarily unavailable'))
    bot = Bot('123456:fixture-token')
    handler = service.webhook_handler(dispatcher, bot)
    request = MagicMock()
    request.json = AsyncMock(return_value={'update_id':903})
    request.headers = {}
    assert (await handler.handle(request)).status == 401
    dispatcher.feed_webhook_update.assert_not_awaited()
    request.headers = {'X-Telegram-Bot-Api-Secret-Token':'fixture-secret'}
    with pytest.raises(HTTPServiceUnavailable):
        await handler.handle(request)
    await bot.session.close()


@pytest.fixture(autouse=True)
def reset_seen():
    _SEEN.clear()
    yield
    _SEEN.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize('fresh', [True, False])
async def test_backend_outage_is_retryable_without_poisoning_memory(fresh):
    handler = AsyncMock()
    event = Update(update_id=900)
    with patch('middlewares.auth.api_client.claim_update', AsyncMock(side_effect=[None, fresh])) as claim:
        with pytest.raises(HTTPServiceUnavailable):
            await DedupMiddleware()(handler, event, {})
        assert 900 not in _SEEN
        await DedupMiddleware()(handler, event, {})
        assert handler.await_count == int(fresh)
        assert claim.await_count == 2


@pytest.mark.asyncio
async def test_duplicate_after_restart_uses_durable_inbox():
    handler = AsyncMock()
    event = Update(update_id=901)
    with patch('middlewares.auth.api_client.claim_update', AsyncMock(side_effect=[True, False])) as claim:
        await DedupMiddleware()(handler, event, {})
        await DedupMiddleware()(handler, event, {})
        _SEEN.clear()  # new process has no memory
        await DedupMiddleware()(handler, event, {})
        handler.assert_awaited_once()
        assert claim.await_count == 2


@pytest.mark.asyncio
async def test_duplicate_during_inflight_handler_has_no_second_action():
    gate = asyncio.Event()
    async def handle(event, data):
        await gate.wait()
    handler = AsyncMock(side_effect=handle)
    event = Update(update_id=902)
    with patch('middlewares.auth.api_client.claim_update', AsyncMock(return_value=True)):
        first = asyncio.create_task(DedupMiddleware()(handler, event, {}))
        await asyncio.sleep(0)
        await DedupMiddleware()(handler, event, {})
        gate.set()
        await first
    handler.assert_awaited_once()


@pytest.mark.asyncio
async def test_restart_resumes_backend_context_without_memory_token():
    state = AsyncMock()
    state.get_data.return_value = {}
    message = message_with_contact()
    intent = '11111111-1111-4111-8111-111111111111'
    with patch('handlers.auth.api_client') as api:
        api.preflight_intent = AsyncMock(return_value=(200, {'ok': True, 'intentId': intent}))
        api.confirm_intent = AsyncMock(return_value=True)
        assert await _complete_pending_intent(message, state, '12345', 'Test User', 'uz')
        api.confirm_intent.assert_awaited_once_with(
            token='', telegram_user_id='12345', displayName='Test User', languageCode='uz', intentId=intent)


@pytest.mark.asyncio
@pytest.mark.parametrize('error,status', [('phone_required',403), ('not_subscribed',403), ('membership_unavailable',503)])
async def test_restart_cannot_skip_security_gates(error, status):
    state = AsyncMock()
    state.get_data.return_value = {}
    with patch('handlers.auth.api_client') as api:
        api.preflight_intent = AsyncMock(return_value=(status, {'error': error}))
        assert not await _complete_pending_intent(message_with_contact(), state, '12345', 'Test User', 'uz')
        api.confirm_intent.assert_not_called()


@pytest.mark.asyncio
async def test_failed_context_save_does_not_enter_phone_flow():
    state = AsyncMock()
    with patch('handlers.auth.api_client') as api:
        api.auth_context = AsyncMock(return_value=(503, {}))
        await cmd_start(message_with_contact(), CommandObject(command='start', args='private-token'), state=state)
        state.set_state.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_requires_durable_clear_before_clearing_ui():
    state = AsyncMock()
    with patch('handlers.auth.api_client') as api:
        api.auth_context = AsyncMock(side_effect=[(503, {}), (200, {'ok': True})])
        await cmd_cancel(message_with_contact(), state)
        state.clear.assert_not_awaited()
        await cmd_cancel(message_with_contact(), state)
        state.clear.assert_awaited_once()
