"""Follow-ups carry bounded teaching context, with existing scope enforcement."""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.riwi_capabilities import RiwiActor
from app.riwi_conversations import get_tutoring_history, RiwiConversationError
from app.riwi_gateway import handle_riwi_chat

ACTOR = RiwiActor("11111111-1111-4111-8111-111111111111", "owner", locale="en")
CID = "22222222-2222-4222-8222-222222222222"
ENV = {"RIWI_EXTERNAL_AI_ENABLED": "true", "AI_EXTERNAL_ENABLED": "true"}


def pair(n, provenance="external_provider", snapshot=None):
    return [{"role": "user", "content": f"Question {n}", "correlationId": str(n)},
            {"role": "assistant", "content": f"Answer {n}", "correlationId": str(n),
             "provenance": provenance, "reportSnapshot": snapshot}]


@pytest.mark.asyncio
async def test_history_excludes_reports_refusals_and_unpaired_turns():
    messages = sum((pair(n) for n in range(4)), [])
    messages += pair(4, "deterministic_report", {"private": True})
    messages += pair(5, "policy_refusal")
    read = AsyncMock(return_value={"messages": messages})
    with patch("app.riwi_conversations.get_conversation_transcript", read):
        history = await get_tutoring_history(None, ACTOR, CID)
    read.assert_awaited_once_with(None, ACTOR, CID, now=None)
    assert history == [{"role": m["role"], "content": m["content"]} for n in range(1, 4) for m in pair(n)]
    assert all(set(m) == {"role", "content"} for m in history)


@pytest.mark.asyncio
async def test_followup_passes_teaching_context_and_rejects_foreign_conversation_before_dispatch():
    history = [{"role": "user", "content": "Explain articles."},
               {"role": "assistant", "content": "A/an depends on the sound."}]
    dispatch = AsyncMock(return_value={"answer": "An hour begins with a vowel sound.",
                                     "provider": {"id": "vercel", "model": "openai/gpt-4.1-mini"}})
    read = AsyncMock(return_value=history)
    with patch("app.riwi_gateway.get_tutoring_history", read), \
         patch("app.riwi_gateway.dispatch_external_riwi_provider", dispatch):
        result = await handle_riwi_chat(None, ACTOR, {"message": "Give another example.", "conversationId": CID},
                                       env=ENV, external_runner=AsyncMock())
        assert result["provenance"] == "external_provider"
        assert dispatch.await_args.kwargs["payload"]["history"] == history
        read.assert_awaited_once_with(None, ACTOR, CID, now=None)
        dispatch.reset_mock()
        read.side_effect = RiwiConversationError("not_found")
        with pytest.raises(RiwiConversationError, match="not_found"):
            await handle_riwi_chat(None, ACTOR, {"message": "Give another example.", "conversationId": CID},
                                   env=ENV, external_runner=AsyncMock())
        dispatch.assert_not_awaited()
