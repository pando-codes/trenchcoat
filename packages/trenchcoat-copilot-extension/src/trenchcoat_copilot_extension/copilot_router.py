from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncGenerator
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI

from ._core import TrenchcoatConfig
from .event_emitter import EventEmitter
from .github_auth import fetch_github_public_keys, verify_github_signature
from .streaming import sse_done

_COPILOT_API_BASE = "https://api.githubcopilot.com"
_DEFAULT_MODEL = "gpt-4o"

# Module-level key cache; refreshed lazily per process startup.
_github_keys_cache: dict[str, str] = {}
_github_keys_lock: asyncio.Lock = asyncio.Lock()


def _default_make_client(api_key: str) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=api_key, base_url=_COPILOT_API_BASE)


def make_copilot_router(
    config: TrenchcoatConfig,
    _make_client: Callable[[str], Any] | None = None,
) -> APIRouter:
    router = APIRouter()
    client_factory = _make_client or _default_make_client

    @router.post("/")
    async def handle_copilot_extension(
        request: Request,
        x_github_token: str | None = Header(None),
        x_github_public_key_identifier: str | None = Header(None),
        x_github_public_key_signature: str | None = Header(None),
    ) -> StreamingResponse:
        if not x_github_token:
            raise HTTPException(status_code=401, detail="Missing X-GitHub-Token")

        raw_body = await request.body()

        if os.getenv("SKIP_GITHUB_SIGNATURE_VERIFICATION", "false").lower() != "true":
            global _github_keys_cache
            async with _github_keys_lock:
                if not _github_keys_cache:
                    _github_keys_cache = await fetch_github_public_keys()
            if not verify_github_signature(
                raw_body,
                x_github_public_key_identifier or "",
                x_github_public_key_signature or "",
                _github_keys_cache,
            ):
                raise HTTPException(status_code=401, detail="Invalid GitHub signature")

        body = json.loads(raw_body)
        messages = body.get("messages", [])
        thread_id = body.get("copilot_thread_id", "")

        emitter = EventEmitter(config, thread_id)
        llm = client_factory(x_github_token)

        async def generate() -> AsyncGenerator[str, None]:
            emitter.append("session_start", {"platform": "github-copilot"})
            emitter.append("prompt_submit", {"message_count": len(messages)})

            input_tokens = 0
            output_tokens = 0

            async with llm.chat.completions.stream(
                model=_DEFAULT_MODEL,
                messages=messages,
            ) as stream:
                async for chunk in stream:
                    yield f"data: {chunk.model_dump_json()}\n\n"
                    if getattr(chunk, "usage", None) is not None:
                        input_tokens = getattr(chunk.usage, "prompt_tokens", 0)
                        output_tokens = getattr(chunk.usage, "completion_tokens", 0)

            yield sse_done()

            emitter.append("assistant_stop", {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            })
            emitter.append("session_end", {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            })
            await emitter.flush()

        return StreamingResponse(generate(), media_type="text/event-stream")

    return router
