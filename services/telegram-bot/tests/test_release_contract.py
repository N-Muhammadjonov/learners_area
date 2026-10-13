import json
import pytest
from unittest.mock import AsyncMock
from config import Settings
import bot


def settings(**overrides):
    values = dict(TELEGRAM_BOT_TOKEN="fixture-only", BOT_SERVICE_SECRET="fixture-only",
                  BOT_MODE="webhook", TELEGRAM_OWNER_ID="9001",
                  TELEGRAM_BOT_USERNAME="learnersareaaccessbot",
                  WEBHOOK_SECRET="fixture_webhook_secret",
                  WEBHOOK_BASE_URL="https://bot.fixture.invalid",
                  PUBLIC_SITE_URL="https://learnersarea.uz",
                  INTERNAL_API_URL="https://learnersarea.uz/api/internal/telegram")
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_production_connections_require_https_without_embedded_credentials():
    settings().validate_startup()
    for field in ("INTERNAL_API_URL", "PUBLIC_SITE_URL", "WEBHOOK_BASE_URL"):
        for value in ("http://fixture.invalid", "https://user:secret@fixture.invalid", "https://fixture.invalid?token=private"):
            with pytest.raises(ValueError):
                settings(**{field: value}).validate_startup()


@pytest.mark.asyncio
async def test_health_and_readiness_do_not_expose_credentials(monkeypatch):
    health = bot.health(None)
    assert health.status == 200
    assert json.loads(health.body) == {"ok": True, "service": "learners-area-telegram-bot"}
    monkeypatch.setattr(bot.api_client, "ready", AsyncMock(return_value=False))
    response = await bot.ready(None)
    assert response.status == 503
    assert json.loads(response.body) == {"ok": False}
    monkeypatch.setattr(bot.api_client, "ready", AsyncMock(return_value=True))
    assert (await bot.ready(None)).status == 200
    monkeypatch.setattr(bot.api_client, "ready", AsyncMock(side_effect=RuntimeError("private")))
    response = await bot.ready(None)
    assert response.status == 503
    assert b"private" not in response.body
