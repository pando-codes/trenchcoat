from __future__ import annotations

import json
import time
import uuid


def sse_chunk(content: str, role: str | None = None) -> str:
    """Format a text delta as a server-sent event in OpenAI chat.completion.chunk format."""
    delta: dict = {"content": content}
    if role is not None:
        delta["role"] = role
    payload = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }
    return f"data: {json.dumps(payload)}\n\n"


def sse_done() -> str:
    return "data: [DONE]\n\n"
