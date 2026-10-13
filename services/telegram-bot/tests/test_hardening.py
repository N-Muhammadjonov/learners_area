import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from security_policy import is_sensitive_update, owner_id_problem, webhook_secret_problem


def test_webhook_secret_format_rejects_unsafe_values():
    assert webhook_secret_problem(None)
    assert webhook_secret_problem("")
    assert webhook_secret_problem("has space")
    assert webhook_secret_problem("bad/secret")
    assert webhook_secret_problem("a" * 257)
    assert webhook_secret_problem("safe_Secret-1") is None


def test_owner_id_must_be_numeric():
    assert owner_id_problem(None)
    assert owner_id_problem("@owner")
    assert owner_id_problem("9001") is None


def test_sensitive_updates_fail_closed_when_dedup_is_unknown():
    assert is_sensitive_update(None, "/start abc") is True
    assert is_sensitive_update("decide_approve_1", None) is True
    assert is_sensitive_update("ust:suspend:1", None) is True
    assert is_sensitive_update("dmok", None) is True
    assert is_sensitive_update("bcok", None) is True
    assert is_sensitive_update("m:home", None) is False
    assert is_sensitive_update(None, "/menu") is False
