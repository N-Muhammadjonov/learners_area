"""Actor-metered Gemini structured JSON transport for Learners Area assessments.

This module uses the existing bounded provider admission, not a second HTTP client.
The API key is never embedded in prompts, frontend code or repository files.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from .ai_runtime import request_json

MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$")
MAX_INPUT_LENGTH = 60_000
MAX_OUTPUT_LENGTH = 96_000


async def request_gemini_json(
    actor_id: str | None,
    model: str,
    system_instruction: str,
    input_data: str | dict[str, Any],
    *,
    max_output_tokens: int = 3000,
) -> dict[str, Any] | None:
    """Return a JSON object; the caller must validate its assessment contract."""
    secret = os.getenv("GEMINI_API_KEY", "").strip()
    if (
        not secret
        or not isinstance(actor_id, str)
        or not actor_id.strip()
        or not isinstance(model, str)
        or not MODEL_PATTERN.fullmatch(model)
        or not isinstance(system_instruction, str)
        or not system_instruction.strip()
        or type(max_output_tokens) is not int
        or not 1 <= max_output_tokens <= 6000
    ):
        return None

    if isinstance(input_data, str):
        content = input_data
    elif isinstance(input_data, dict):
        content = json.dumps(input_data, ensure_ascii=False, separators=(",", ":"))
    else:
        return None
    if not content or len(content) > MAX_INPUT_LENGTH:
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": content}]}],
        "generationConfig": {
            "maxOutputTokens": max_output_tokens,
            "responseMimeType": "application/json",
        },
    }
    response = await request_json(
        actor_id,
        url,
        {"content-type": "application/json", "x-goog-api-key": secret},
        payload=body,
        timeout=25,
        max_bytes=200_000,
    )
    if not isinstance(response, dict):
        return None

    try:
        candidates = response["candidates"]
        if not isinstance(candidates, list) or len(candidates) != 1:
            return None
        candidate = candidates[0]
        if candidate.get("finishReason") != "STOP":
            return None
        parts = candidate["content"]["parts"]
        if not isinstance(parts, list):
            return None
        reply = "".join(
            part["text"]
            for part in parts
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
        if not reply or len(reply) > MAX_OUTPUT_LENGTH:
            return None
        parsed = json.loads(reply)
        return parsed if isinstance(parsed, dict) else None
    except (KeyError, TypeError, ValueError, IndexError):
        return None
