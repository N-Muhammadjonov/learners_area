import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from html_text import esc
from middlewares.auth import allows


def test_html_escape_user_text():
    assert esc("<b>a&b</b>") == "&lt;b&gt;a&amp;b&lt;/b&gt;"
    assert "o'quvchi" in "o'quvchi"


def test_website_role_is_not_enough():
    assert allows({"isPrimaryOwner": False, "permissions": []}, "ADMISSIONS") is False
    assert allows({"isPrimaryOwner": False, "permissions": ["SUPPORT"]}, "ADMISSIONS") is False
    assert allows({"isPrimaryOwner": False, "permissions": ["ADMISSIONS"]}, "ADMISSIONS") is True
    assert allows({"isPrimaryOwner": True, "permissions": []}, "DANGEROUS_USER_DELETE") is True
    assert allows(None, "VIEW_USERS") is False


def test_webhook_mode_requires_secret(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("BOT_SERVICE_SECRET", "secret")
    monkeypatch.setenv("BOT_MODE", "webhook")
    monkeypatch.delenv("WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("WEBHOOK_BASE_URL", raising=False)
    from importlib import reload
    import config

    reloaded = reload(config)
    try:
        reloaded.config.require_webhook()
        raised = False
    except ValueError:
        raised = True
    assert raised
