import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from owner_callbacks import notice_button_specs, numeric_target, opaque_callback
from security_policy import is_sensitive_update


UUID = "11111111-1111-4111-8111-111111111111"


def test_owner_callbacks_are_opaque_and_sensitive():
    data = opaque_callback("wta", UUID)
    assert data == f"wta:{UUID}"
    assert "password" not in data
    assert opaque_callback("wta", "@owner") is None
    assert opaque_callback("secret", UUID) is None
    assert is_sensitive_update(data, None) is True
    assert is_sensitive_update("bhr:" + UUID, None) is True
    assert is_sensitive_update("bha:" + UUID, None) is True
    assert is_sensitive_update("m:home", None) is False


def test_notice_buttons_use_only_the_correlation_id():
    specs = notice_button_specs("website.owner_transfer", UUID)
    assert specs == [("Approve", f"wta:{UUID}"), ("Reject", f"wtr:{UUID}")]
    assert notice_button_specs("telegram.owner_handover_current", UUID)[0][1].startswith("bhc:")
    assert notice_button_specs("telegram.owner_handover_target", "not-a-uuid") == []
    assert notice_button_specs("telegram.owner_transferred", UUID) == []


def test_username_is_not_a_handover_target():
    assert numeric_target("@owner") is None
    assert numeric_target("owner") is None
    assert numeric_target("200") == "200"
