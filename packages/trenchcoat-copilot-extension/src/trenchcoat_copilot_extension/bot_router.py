from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException, Request
from openai import AsyncOpenAI

from ._core import TrenchcoatConfig
from .event_emitter import EventEmitter

_DEFAULT_MODEL = "gpt-4o"


def _default_make_client() -> AsyncOpenAI:
    return AsyncOpenAI()


def make_bot_router(
    config: TrenchcoatConfig,
    _make_client: Callable[[], Any] | None = None,
) -> APIRouter:
    router = APIRouter()
    client_factory = _make_client or _default_make_client

    @router.post("/bot")
    async def handle_bot_activity(
        request: Request,
        authorization: str | None = Header(None),
    ) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")

        body = await request.json()
        activity_type = body.get("type", "")

        if activity_type != "message":
            return {"type": "invokeResponse", "value": {"status": 200}}

        conversation_id = body.get("conversation", {}).get("id", "")
        text = body.get("text", "")

        emitter = EventEmitter(config, conversation_id)
        emitter.append("session_start", {"platform": "m365-copilot"})
        emitter.append("prompt_submit", {"text_length": len(text)})

        llm = client_factory()
        response = await llm.chat.completions.create(
            model=_DEFAULT_MODEL,
            messages=[{"role": "user", "content": text}],
        )
        reply_text = response.choices[0].message.content

        emitter.append("assistant_stop", {
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
        })
        emitter.append("session_end", {
            "input_tokens": response.usage.prompt_tokens,
            "output_tokens": response.usage.completion_tokens,
        })
        await emitter.flush()

        return {
            "type": "message",
            "text": reply_text,
            "replyToId": body.get("id"),
        }

    return router
