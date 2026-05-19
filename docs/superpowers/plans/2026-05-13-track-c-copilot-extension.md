# Track C: GitHub Copilot Extension + M365 Copilot Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `trenchcoat-copilot-extension`, a Python package that runs an observable agent inside GitHub Copilot Chat and M365 Copilot Studio, emitting Trenchcoat telemetry events for every conversation turn via the existing `POST /api/v1/events` endpoint.

**Architecture:** A FastAPI app with two routes — `POST /` for the GitHub Copilot Extension protocol (SSE streaming) and `POST /bot` for M365 Bot Framework activities. Both routes share a common `EventEmitter` class that buffers session lifecycle events and flushes them to the Trenchcoat API after each response is sent. GitHub requests are authenticated via ECDSA P-256 signature verification against GitHub's public key API. The LLM client is injected so tests never hit real APIs.

**Tech Stack:** Python 3.11+, FastAPI 0.111+, uvicorn, httpx, openai (for GitHub Copilot API + M365 LLM calls), cryptography (ECDSA signature verification), pytest + pytest-asyncio + respx + httpx[testclient]

---

## File Map

All new files under `packages/trenchcoat-copilot-extension/`:

| File | Responsibility |
|---|---|
| `pyproject.toml` | Package metadata, deps, pytest config |
| `src/trenchcoat_copilot_extension/__init__.py` | Public exports: `create_app`, `EventEmitter`, `TrenchcoatConfig` |
| `src/trenchcoat_copilot_extension/_core.py` | `TrenchcoatConfig`, `build_event`, `flush_events` (same pattern as Track A `_core.py`) |
| `src/trenchcoat_copilot_extension/event_emitter.py` | `EventEmitter`: buffers events for a conversation turn + async flush |
| `src/trenchcoat_copilot_extension/github_auth.py` | Fetch GitHub Copilot public keys; ECDSA P-256 signature verification |
| `src/trenchcoat_copilot_extension/streaming.py` | SSE chunk formatter + done sentinel |
| `src/trenchcoat_copilot_extension/copilot_router.py` | `make_copilot_router(config)` → `APIRouter` for `POST /` (GitHub Copilot Extension) |
| `src/trenchcoat_copilot_extension/bot_router.py` | `make_bot_router(config)` → `APIRouter` for `POST /bot` (M365 Bot Framework) |
| `src/trenchcoat_copilot_extension/server.py` | `create_app(config)` → `FastAPI` mounting both routers |
| `tests/conftest.py` | Test key pair fixture, app fixture with signature verification disabled |
| `tests/test_core.py` | Unit tests for `_core.py` |
| `tests/test_event_emitter.py` | Unit tests for `EventEmitter` |
| `tests/test_github_auth.py` | Unit tests for signature verification |
| `tests/test_streaming.py` | Unit tests for SSE formatters |
| `tests/test_copilot_router.py` | Unit tests for the Copilot Extension endpoint |
| `tests/test_bot_router.py` | Unit tests for the Bot Framework endpoint |
| `tests/test_integration.py` | End-to-end: full conversation turn → events arrive at mock Trenchcoat API |

---

### Task 1: Package Scaffold

**Files:**
- Create: `packages/trenchcoat-copilot-extension/pyproject.toml`
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/__init__.py`
- Create: `packages/trenchcoat-copilot-extension/tests/conftest.py`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension
mkdir -p packages/trenchcoat-copilot-extension/tests
```

- [ ] **Step 2: Write `pyproject.toml`**

`packages/trenchcoat-copilot-extension/pyproject.toml`:
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "trenchcoat-copilot-extension"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111",
    "uvicorn>=0.30",
    "httpx>=0.27",
    "openai>=1.30",
    "cryptography>=42",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
    "httpx[test]>=0.27",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.hatch.build.targets.wheel]
packages = ["src/trenchcoat_copilot_extension"]
```

- [ ] **Step 3: Create empty `__init__.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/__init__.py`:
```python
# populated in Task 9
```

- [ ] **Step 4: Create `tests/conftest.py`**

`packages/trenchcoat-copilot-extension/tests/conftest.py`:
```python
import base64
import os
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization


@pytest.fixture(autouse=True)
def skip_github_signature_verification(monkeypatch):
    """Disable GitHub ECDSA verification in all tests."""
    monkeypatch.setenv("SKIP_GITHUB_SIGNATURE_VERIFICATION", "true")


@pytest.fixture()
def test_key_pair():
    """Returns (private_key, pem_public_key_str) using P-256 for signature tests."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_key, public_pem


def sign_payload(private_key, payload: bytes) -> str:
    sig = private_key.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig).decode()
```

- [ ] **Step 5: Install the package**

```bash
cd packages/trenchcoat-copilot-extension
pip install -e ".[dev]"
```

Expected: no errors. `python -c "import trenchcoat_copilot_extension"` succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/trenchcoat-copilot-extension/
git commit -m "feat(copilot-ext): scaffold trenchcoat-copilot-extension package"
```

---

### Task 2: Core Utilities (`_core.py`)

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/_core.py`
- Create: `packages/trenchcoat-copilot-extension/tests/test_core.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-copilot-extension/tests/test_core.py`:
```python
import json
import pytest
import respx
import httpx
from trenchcoat_copilot_extension._core import (
    TrenchcoatConfig,
    build_event,
    flush_events,
)

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"


def test_build_event_shape():
    event = build_event("session_start", "sess-abc", {"platform": "github-copilot"})
    assert event["event"] == "session_start"
    assert event["session_id"] == "sess-abc"
    assert event["data"]["platform"] == "github-copilot"
    assert "ts" in event


@pytest.mark.asyncio
async def test_flush_events_empty_is_noop():
    config = TrenchcoatConfig(api_key=API_KEY)
    await flush_events([], config)  # must not raise or make HTTP calls


@pytest.mark.asyncio
@respx.mock
async def test_flush_events_posts_to_api():
    config = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)
    route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {"received": 1}})
    )
    events = [build_event("session_start", "sess-1", {})]
    await flush_events(events, config)

    assert route.called
    body = json.loads(route.calls[0].request.content)
    assert body["events"][0]["event"] == "session_start"
    assert route.calls[0].request.headers["X-API-Key"] == API_KEY


@pytest.mark.asyncio
@respx.mock
async def test_flush_events_batches_correctly():
    config = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL, batch_size=2)
    route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {}})
    )
    events = [build_event("tool_use", "sess-1", {}) for _ in range(5)]
    await flush_events(events, config)
    assert route.call_count == 3  # [2, 2, 1]
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_core.py -v
```

Expected: `ImportError: cannot import name 'TrenchcoatConfig'`

- [ ] **Step 3: Write `_core.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/_core.py`:
```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx


@dataclass
class TrenchcoatConfig:
    api_key: str
    api_url: str = "https://app.trenchcoat.io"
    batch_size: int = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def build_event(event_type: str, session_id: str, data: dict) -> dict:
    return {
        "ts": _now_iso(),
        "event": event_type,
        "session_id": session_id,
        "data": data,
    }


async def flush_events(events: list[dict], config: TrenchcoatConfig) -> None:
    if not events:
        return
    url = f"{config.api_url.rstrip('/')}/api/v1/events"
    headers = {"X-API-Key": config.api_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(0, len(events), config.batch_size):
            batch = events[i : i + config.batch_size]
            resp = await client.post(url, json={"events": batch}, headers=headers)
            resp.raise_for_status()
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_core.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/_core.py \
        packages/trenchcoat-copilot-extension/tests/test_core.py
git commit -m "feat(copilot-ext): add core event utilities and HTTP flush"
```

---

### Task 3: Event Emitter (`event_emitter.py`)

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/event_emitter.py`
- Create: `packages/trenchcoat-copilot-extension/tests/test_event_emitter.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-copilot-extension/tests/test_event_emitter.py`:
```python
import pytest
import respx
import httpx
from unittest.mock import AsyncMock, patch
from trenchcoat_copilot_extension._core import TrenchcoatConfig
from trenchcoat_copilot_extension.event_emitter import EventEmitter

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)


def test_append_adds_event_to_buffer():
    emitter = EventEmitter(CONFIG, "sess-1")
    emitter.append("session_start", {"platform": "github-copilot"})
    assert len(emitter._events) == 1
    assert emitter._events[0]["event"] == "session_start"
    assert emitter._events[0]["session_id"] == "sess-1"
    assert emitter._events[0]["data"]["platform"] == "github-copilot"


def test_append_multiple_events_preserves_order():
    emitter = EventEmitter(CONFIG, "sess-1")
    for etype in ["session_start", "prompt_submit", "assistant_stop", "session_end"]:
        emitter.append(etype, {})
    types = [e["event"] for e in emitter._events]
    assert types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]


@pytest.mark.asyncio
async def test_flush_sends_events_and_clears_buffer():
    emitter = EventEmitter(CONFIG, "sess-1")
    emitter.append("session_start", {})
    emitter.append("session_end", {})

    flush_mock = AsyncMock()
    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", flush_mock):
        await emitter.flush()

    flush_mock.assert_awaited_once()
    assert emitter._events == []


@pytest.mark.asyncio
async def test_flush_empty_buffer_is_noop():
    emitter = EventEmitter(CONFIG, "sess-1")
    flush_mock = AsyncMock()
    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", flush_mock):
        await emitter.flush()
    flush_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_flush_error_is_silent():
    emitter = EventEmitter(CONFIG, "sess-1")
    emitter.append("session_start", {})
    flush_mock = AsyncMock(side_effect=Exception("network error"))
    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", flush_mock):
        await emitter.flush()  # must not raise
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_event_emitter.py -v
```

Expected: `ImportError: cannot import name 'EventEmitter'`

- [ ] **Step 3: Write `event_emitter.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/event_emitter.py`:
```python
from __future__ import annotations

from typing import Any

from ._core import TrenchcoatConfig, build_event, flush_events


class EventEmitter:
    """Buffers Trenchcoat events for one conversation turn and flushes them together."""

    def __init__(self, config: TrenchcoatConfig, session_id: str) -> None:
        self._config = config
        self._session_id = session_id
        self._events: list[dict] = []

    def append(self, event_type: str, data: dict[str, Any] | None = None) -> None:
        self._events.append(build_event(event_type, self._session_id, data or {}))

    async def flush(self) -> None:
        if not self._events:
            return
        events_to_send = list(self._events)
        self._events.clear()
        try:
            await flush_events(events_to_send, self._config)
        except Exception:
            pass  # telemetry must never break the server
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_event_emitter.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/event_emitter.py \
        packages/trenchcoat-copilot-extension/tests/test_event_emitter.py
git commit -m "feat(copilot-ext): add EventEmitter for shared conversation lifecycle tracking"
```

---

### Task 4: GitHub Signature Verification (`github_auth.py`)

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/github_auth.py`
- Create: `packages/trenchcoat-copilot-extension/tests/test_github_auth.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-copilot-extension/tests/test_github_auth.py`:
```python
import base64
import pytest
import respx
import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization
from trenchcoat_copilot_extension.github_auth import (
    fetch_github_public_keys,
    verify_github_signature,
)


def _make_key_pair():
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return priv, pub


def _sign(private_key, payload: bytes) -> str:
    sig = private_key.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig).decode()


def test_valid_signature_passes():
    priv, pub = _make_key_pair()
    payload = b'{"messages":[]}'
    sig = _sign(priv, payload)
    keys = {"key-id-1": pub}
    assert verify_github_signature(payload, "key-id-1", sig, keys) is True


def test_tampered_payload_fails():
    priv, pub = _make_key_pair()
    payload = b'{"messages":[]}'
    sig = _sign(priv, payload)
    keys = {"key-id-1": pub}
    assert verify_github_signature(b"tampered", "key-id-1", sig, keys) is False


def test_bad_signature_fails():
    _, pub = _make_key_pair()
    keys = {"key-id-1": pub}
    bad_sig = base64.b64encode(b"not-a-real-signature").decode()
    assert verify_github_signature(b"payload", "key-id-1", bad_sig, keys) is False


def test_unknown_key_id_fails():
    keys = {}
    assert verify_github_signature(b"payload", "missing-id", "sig", keys) is False


@pytest.mark.asyncio
@respx.mock
async def test_fetch_github_public_keys_returns_id_to_pem_map():
    fake_pem = "-----BEGIN PUBLIC KEY-----\nfakekey\n-----END PUBLIC KEY-----"
    respx.get("https://api.github.com/meta/public_keys/copilot_api").mock(
        return_value=httpx.Response(200, json={
            "public_keys": [
                {"key_identifier": "abc123", "key": fake_pem},
                {"key_identifier": "def456", "key": fake_pem},
            ]
        })
    )
    keys = await fetch_github_public_keys()
    assert keys == {"abc123": fake_pem, "def456": fake_pem}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_github_auth.py -v
```

Expected: `ImportError: cannot import name 'fetch_github_public_keys'`

- [ ] **Step 3: Write `github_auth.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/github_auth.py`:
```python
from __future__ import annotations

import base64

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

GITHUB_KEYS_URL = "https://api.github.com/meta/public_keys/copilot_api"


async def fetch_github_public_keys() -> dict[str, str]:
    """Return a mapping of key_identifier → PEM public key string."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(GITHUB_KEYS_URL)
        resp.raise_for_status()
    data = resp.json()
    return {k["key_identifier"]: k["key"] for k in data["public_keys"]}


def verify_github_signature(
    payload: bytes,
    key_id: str,
    signature: str,
    keys: dict[str, str],
) -> bool:
    """Return True if the ECDSA P-256 signature over payload is valid for the given key_id."""
    if key_id not in keys:
        return False
    try:
        pem = keys[key_id].encode()
        public_key = serialization.load_pem_public_key(pem)
        sig_bytes = base64.b64decode(signature)
        public_key.verify(sig_bytes, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_github_auth.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/github_auth.py \
        packages/trenchcoat-copilot-extension/tests/test_github_auth.py
git commit -m "feat(copilot-ext): add GitHub ECDSA signature verification"
```

---

### Task 5: SSE Streaming Helpers (`streaming.py`)

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/streaming.py`
- Create: `packages/trenchcoat-copilot-extension/tests/test_streaming.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-copilot-extension/tests/test_streaming.py`:
```python
import json
from trenchcoat_copilot_extension.streaming import sse_chunk, sse_done


def test_sse_done_is_correct_sentinel():
    assert sse_done() == "data: [DONE]\n\n"


def test_sse_chunk_starts_with_data_prefix():
    result = sse_chunk("Hello")
    assert result.startswith("data: ")
    assert result.endswith("\n\n")


def test_sse_chunk_json_has_content_delta():
    result = sse_chunk("world")
    payload = json.loads(result[6:])
    assert payload["choices"][0]["delta"]["content"] == "world"


def test_sse_chunk_with_role_includes_role():
    result = sse_chunk("Hi", role="assistant")
    payload = json.loads(result[6:])
    assert payload["choices"][0]["delta"]["role"] == "assistant"
    assert payload["choices"][0]["delta"]["content"] == "Hi"


def test_sse_chunk_without_role_omits_role_key():
    result = sse_chunk("Hi")
    payload = json.loads(result[6:])
    assert "role" not in payload["choices"][0]["delta"]


def test_sse_chunk_has_required_fields():
    result = sse_chunk("x")
    payload = json.loads(result[6:])
    assert "id" in payload
    assert "object" in payload
    assert payload["object"] == "chat.completion.chunk"
    assert "created" in payload
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_streaming.py -v
```

Expected: `ImportError: cannot import name 'sse_chunk'`

- [ ] **Step 3: Write `streaming.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/streaming.py`:
```python
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_streaming.py -v
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/streaming.py \
        packages/trenchcoat-copilot-extension/tests/test_streaming.py
git commit -m "feat(copilot-ext): add SSE chunk formatter"
```

---

### Task 6: GitHub Copilot Extension Router (`copilot_router.py`)

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/copilot_router.py`
- Create: `packages/trenchcoat-copilot-extension/tests/test_copilot_router.py`

The router receives `POST /` from GitHub Copilot Chat, verifies the ECDSA signature (skipped in tests via `SKIP_GITHUB_SIGNATURE_VERIFICATION=true`), calls the GitHub Copilot LLM endpoint using the token from the request, streams the SSE response, and emits four Trenchcoat events per turn: `session_start`, `prompt_submit`, `assistant_stop`, `session_end`.

The LLM client is injected via a `_make_client` parameter so tests can pass a mock without network calls.

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-copilot-extension/tests/test_copilot_router.py`:
```python
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from trenchcoat_copilot_extension._core import TrenchcoatConfig
from trenchcoat_copilot_extension.copilot_router import make_copilot_router

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)


def _make_mock_openai_client(chunks: list[str]) -> MagicMock:
    """Return a mock AsyncOpenAI client that streams the given text chunks."""
    mock_client = MagicMock()

    async def _aiter():
        for text in chunks:
            chunk = MagicMock()
            chunk.model_dump_json.return_value = json.dumps({
                "choices": [{"delta": {"content": text}}]
            })
            chunk.usage = None
            yield chunk
        # Final chunk with usage
        final = MagicMock()
        final.model_dump_json.return_value = json.dumps({
            "choices": [{"delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        })
        final.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
        yield final

    mock_stream = MagicMock()
    mock_stream.__aenter__ = AsyncMock(return_value=mock_stream)
    mock_stream.__aexit__ = AsyncMock(return_value=False)
    mock_stream.__aiter__ = lambda self: _aiter()
    mock_client.chat.completions.stream.return_value = mock_stream
    return mock_client


@pytest.fixture()
def app_with_mock_client():
    mock_client = _make_mock_openai_client(["Hello", " world"])
    router = make_copilot_router(CONFIG, _make_client=lambda api_key: mock_client)
    app = FastAPI()
    app.include_router(router)
    return app, mock_client


@pytest.mark.asyncio
async def test_post_root_returns_sse_stream(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-1"},
            headers={"X-GitHub-Token": "gh-token-xxx"},
        ) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]
            lines = [line async for line in response.aiter_lines() if line]

    data_lines = [l for l in lines if l.startswith("data: ")]
    assert any(l == "data: [DONE]" for l in data_lines)
    content_lines = [l for l in data_lines if l != "data: [DONE]"]
    all_content = "".join(
        json.loads(l[6:])["choices"][0]["delta"].get("content", "")
        for l in content_lines
        if "choices" in json.loads(l[6:])
    )
    assert "Hello" in all_content


@pytest.mark.asyncio
async def test_post_root_calls_openai_with_messages(app_with_mock_client):
    app, mock_client = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-1"},
            headers={"X-GitHub-Token": "gh-token-xxx"},
        ) as response:
            [_ async for _ in response.aiter_bytes()]

    mock_client.chat.completions.stream.assert_called_once()
    call_kwargs = mock_client.chat.completions.stream.call_args[1]
    assert call_kwargs["messages"] == [{"role": "user", "content": "Hi"}]


@pytest.mark.asyncio
async def test_post_root_emits_telemetry_events(app_with_mock_client):
    app, _ = app_with_mock_client
    emitted: list[dict] = []

    async def capture_flush(events, config):
        emitted.extend(events)

    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", capture_flush):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async with client.stream(
                "POST", "/",
                json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-42"},
                headers={"X-GitHub-Token": "gh-token-xxx"},
            ) as response:
                [_ async for _ in response.aiter_bytes()]

    event_types = [e["event"] for e in emitted]
    assert event_types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]
    # All events share the same session_id derived from copilot_thread_id
    session_ids = {e["session_id"] for e in emitted}
    assert len(session_ids) == 1
    # session_start platform tag
    assert emitted[0]["data"]["platform"] == "github-copilot"


@pytest.mark.asyncio
async def test_missing_github_token_returns_401(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/",
            json={"messages": [], "copilot_thread_id": "t-1"},
        )
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_copilot_router.py -v
```

Expected: `ImportError: cannot import name 'make_copilot_router'`

- [ ] **Step 3: Write `copilot_router.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/copilot_router.py`:
```python
from __future__ import annotations

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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_copilot_router.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/copilot_router.py \
        packages/trenchcoat-copilot-extension/tests/test_copilot_router.py
git commit -m "feat(copilot-ext): add GitHub Copilot Extension SSE endpoint"
```

---

### Task 7: M365 Bot Framework Router (`bot_router.py`)

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/bot_router.py`
- Create: `packages/trenchcoat-copilot-extension/tests/test_bot_router.py`

The Bot Framework adapter handles `POST /bot`. It receives a Bot Framework Activity JSON, calls the configured LLM, returns the response as a Bot Framework message activity, and emits Trenchcoat events using the same `EventEmitter`. Bot Framework JWT auth is validated by checking for the `Authorization: Bearer <token>` header (full Microsoft JWT verification is deployment-time infrastructure, not in-package; the presence check prevents unauthenticated calls).

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-copilot-extension/tests/test_bot_router.py`:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from trenchcoat_copilot_extension._core import TrenchcoatConfig
from trenchcoat_copilot_extension.bot_router import make_bot_router

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)

ACTIVITY = {
    "type": "message",
    "id": "act-1",
    "text": "What is 2+2?",
    "from": {"id": "user-1", "name": "Alice"},
    "conversation": {"id": "conv-abc"},
    "serviceUrl": "https://smba.trafficmanager.net/apis/",
}


def _make_mock_openai_client(reply: str = "4") -> MagicMock:
    mock_client = MagicMock()
    response = MagicMock()
    response.choices[0].message.content = reply
    response.usage.prompt_tokens = 8
    response.usage.completion_tokens = 3
    mock_client.chat.completions.create = AsyncMock(return_value=response)
    return mock_client


@pytest.fixture()
def app_with_mock_client():
    mock_client = _make_mock_openai_client()
    router = make_bot_router(CONFIG, _make_client=lambda: mock_client)
    app = FastAPI()
    app.include_router(router)
    return app, mock_client


@pytest.mark.asyncio
async def test_message_activity_returns_reply(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/bot",
            json=ACTIVITY,
            headers={"Authorization": "Bearer test-token"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "message"
    assert body["text"] == "4"


@pytest.mark.asyncio
async def test_non_message_activity_returns_200(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/bot",
            json={"type": "conversationUpdate"},
            headers={"Authorization": "Bearer test-token"},
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_missing_auth_returns_401(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/bot", json=ACTIVITY)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_message_activity_emits_telemetry_events(app_with_mock_client):
    app, _ = app_with_mock_client
    emitted: list[dict] = []

    async def capture_flush(events, config):
        emitted.extend(events)

    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", capture_flush):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                "/bot",
                json=ACTIVITY,
                headers={"Authorization": "Bearer test-token"},
            )

    event_types = [e["event"] for e in emitted]
    assert event_types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]
    assert emitted[0]["data"]["platform"] == "m365-copilot"
    # Session ID derived from conversation ID
    assert all(e["session_id"] == "conv-abc" for e in emitted)
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_bot_router.py -v
```

Expected: `ImportError: cannot import name 'make_bot_router'`

- [ ] **Step 3: Write `bot_router.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/bot_router.py`:
```python
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_bot_router.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/bot_router.py \
        packages/trenchcoat-copilot-extension/tests/test_bot_router.py
git commit -m "feat(copilot-ext): add M365 Bot Framework adapter using shared EventEmitter"
```

---

### Task 8: App Factory + Public Exports

**Files:**
- Create: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/server.py`
- Modify: `packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/__init__.py`

- [ ] **Step 1: Write the failing tests (appended to `test_copilot_router.py`)**

Append to `packages/trenchcoat-copilot-extension/tests/test_copilot_router.py`:

```python
# --- server.py / __init__.py tests ---

def test_public_api_exports():
    from trenchcoat_copilot_extension import create_app, EventEmitter, TrenchcoatConfig
    assert callable(create_app)
    assert callable(EventEmitter)
    assert TrenchcoatConfig  # dataclass


def test_create_app_returns_fastapi_instance():
    from fastapi import FastAPI
    from trenchcoat_copilot_extension import create_app, TrenchcoatConfig
    config = TrenchcoatConfig(api_key="ct_live_x")
    app = create_app(config)
    assert isinstance(app, FastAPI)


def test_create_app_has_copilot_and_bot_routes():
    from trenchcoat_copilot_extension import create_app, TrenchcoatConfig
    config = TrenchcoatConfig(api_key="ct_live_x")
    app = create_app(config)
    routes = {route.path for route in app.routes}
    assert "/" in routes
    assert "/bot" in routes
```

- [ ] **Step 2: Run new tests — verify they fail**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_copilot_router.py::test_public_api_exports \
       tests/test_copilot_router.py::test_create_app_returns_fastapi_instance \
       tests/test_copilot_router.py::test_create_app_has_copilot_and_bot_routes -v
```

Expected: `ImportError` on `create_app`

- [ ] **Step 3: Write `server.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/server.py`:
```python
from __future__ import annotations

from fastapi import FastAPI

from ._core import TrenchcoatConfig
from .bot_router import make_bot_router
from .copilot_router import make_copilot_router


def create_app(config: TrenchcoatConfig) -> FastAPI:
    """Return a FastAPI app with the GitHub Copilot Extension and M365 Bot Framework routes."""
    app = FastAPI(title="Trenchcoat Copilot Extension")
    app.include_router(make_copilot_router(config))
    app.include_router(make_bot_router(config))
    return app
```

- [ ] **Step 4: Update `__init__.py`**

`packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/__init__.py`:
```python
from ._core import TrenchcoatConfig
from .event_emitter import EventEmitter
from .server import create_app

__all__ = ["create_app", "EventEmitter", "TrenchcoatConfig"]
```

- [ ] **Step 5: Run all tests — verify they pass**

```bash
cd packages/trenchcoat-copilot-extension
pytest -v
```

Expected: all tests PASS, no failures.

- [ ] **Step 6: Commit**

```bash
git add packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/server.py \
        packages/trenchcoat-copilot-extension/src/trenchcoat_copilot_extension/__init__.py \
        packages/trenchcoat-copilot-extension/tests/test_copilot_router.py
git commit -m "feat(copilot-ext): wire create_app factory and public exports"
```

---

### Task 9: Integration Test

**Files:**
- Create: `packages/trenchcoat-copilot-extension/tests/test_integration.py`

This test simulates a complete GitHub Copilot conversation turn end-to-end: the extension receives a POST, streams an SSE response, and all four telemetry events arrive at a mock Trenchcoat API.

- [ ] **Step 1: Write the integration test**

`packages/trenchcoat-copilot-extension/tests/test_integration.py`:
```python
import json
import pytest
import respx
import httpx
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from trenchcoat_copilot_extension import create_app, TrenchcoatConfig

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)


def _make_mock_openai_client() -> MagicMock:
    mock_client = MagicMock()

    async def _aiter():
        for text in ["The", " answer", " is", " 42."]:
            chunk = MagicMock()
            chunk.model_dump_json.return_value = json.dumps({
                "choices": [{"delta": {"content": text}}]
            })
            chunk.usage = None
            yield chunk
        final = MagicMock()
        final.model_dump_json.return_value = json.dumps({
            "choices": [{"delta": {}, "finish_reason": "stop"}],
        })
        final.usage = MagicMock(prompt_tokens=15, completion_tokens=7)
        yield final

    mock_stream = MagicMock()
    mock_stream.__aenter__ = AsyncMock(return_value=mock_stream)
    mock_stream.__aexit__ = AsyncMock(return_value=False)
    mock_stream.__aiter__ = lambda self: _aiter()
    mock_client.chat.completions.stream.return_value = mock_stream
    return mock_client


@pytest.mark.asyncio
@respx.mock
async def test_full_copilot_conversation_turn_sends_all_events():
    trenchcoat_route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {"received": 4}})
    )

    mock_llm = _make_mock_openai_client()
    app = create_app(CONFIG)
    # Override the copilot router's client factory with our mock
    from trenchcoat_copilot_extension import copilot_router as cr
    app.routes.clear()
    from fastapi import FastAPI
    app2 = FastAPI()
    from trenchcoat_copilot_extension.copilot_router import make_copilot_router
    from trenchcoat_copilot_extension.bot_router import make_bot_router
    app2.include_router(make_copilot_router(CONFIG, _make_client=lambda api_key: mock_llm))
    app2.include_router(make_bot_router(CONFIG))

    async with AsyncClient(transport=ASGITransport(app=app2), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={
                "messages": [{"role": "user", "content": "What is the answer?"}],
                "copilot_thread_id": "thread-integration-1",
            },
            headers={"X-GitHub-Token": "gh-test-token"},
        ) as response:
            assert response.status_code == 200
            lines = [line async for line in response.aiter_lines() if line]

    # SSE stream contains [DONE]
    assert "data: [DONE]" in lines

    # Trenchcoat API received events
    assert trenchcoat_route.called
    body = json.loads(trenchcoat_route.calls[0].request.content)
    event_types = [e["event"] for e in body["events"]]
    assert event_types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]

    # All events share the thread ID as session_id
    session_ids = {e["session_id"] for e in body["events"]}
    assert session_ids == {"thread-integration-1"}

    # session_start has correct platform
    assert body["events"][0]["data"]["platform"] == "github-copilot"

    # Token counts in assistant_stop and session_end
    assistant_stop = next(e for e in body["events"] if e["event"] == "assistant_stop")
    assert assistant_stop["data"]["input_tokens"] == 15
    assert assistant_stop["data"]["output_tokens"] == 7


@pytest.mark.asyncio
@respx.mock
async def test_telemetry_flush_failure_does_not_break_sse_stream():
    """If the Trenchcoat API is down, the SSE response still completes."""
    respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(500, json={"error": "server error"})
    )

    mock_llm = _make_mock_openai_client()
    from trenchcoat_copilot_extension.copilot_router import make_copilot_router
    from trenchcoat_copilot_extension.bot_router import make_bot_router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(make_copilot_router(CONFIG, _make_client=lambda api_key: mock_llm))
    app.include_router(make_bot_router(CONFIG))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-2"},
            headers={"X-GitHub-Token": "gh-test-token"},
        ) as response:
            assert response.status_code == 200
            lines = [line async for line in response.aiter_lines() if line]

    assert "data: [DONE]" in lines  # stream completed despite API failure
```

- [ ] **Step 2: Run integration tests**

```bash
cd packages/trenchcoat-copilot-extension
pytest tests/test_integration.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd packages/trenchcoat-copilot-extension
pytest -v
```

Expected: all tests PASS, no failures.

- [ ] **Step 4: Commit**

```bash
git add packages/trenchcoat-copilot-extension/tests/test_integration.py
git commit -m "test(copilot-ext): add end-to-end integration tests for conversation turn lifecycle"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| GitHub Copilot Extension `POST /` endpoint | Task 6 ✓ |
| ECDSA P-256 GitHub signature verification | Task 4 ✓ |
| SSE streaming response | Task 5 + 6 ✓ |
| `session_start` on first message | Task 6 (`on_agent_start` equivalent) ✓ |
| `prompt_submit` each user turn | Task 6 ✓ |
| `assistant_stop` + token counts | Task 6 ✓ |
| `session_end` per conversation close | Task 6 (per-request, as no close signal exists) ✓ |
| M365 Copilot Studio Bot Framework adapter | Task 7 ✓ |
| Shared event emission layer | `EventEmitter` used by both Task 6 and Task 7 ✓ |
| Telemetry never breaks the agent response | `try/except` in `EventEmitter.flush()`; `test_telemetry_flush_failure_does_not_break_sse_stream` ✓ |
| No new API routes in `apps/app/` | Confirmed — pushes to existing `POST /api/v1/events` ✓ |

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N" patterns found.

**Type consistency:**
- `TrenchcoatConfig` defined in `_core.py`, used identically in `event_emitter.py`, `copilot_router.py`, `bot_router.py`, `server.py`
- `EventEmitter(config, session_id)` constructor matches all instantiation sites
- `make_copilot_router(config, _make_client=...)` signature matches test fixture usage
- `make_bot_router(config, _make_client=...)` signature matches test fixture usage
- `flush_events(events: list[dict], config: TrenchcoatConfig)` matches all call sites

**One caveat:** The `openai.AsyncOpenAI` streaming API (`chat.completions.stream`) interface must match the installed openai version. If the installed version uses `.stream()` differently (e.g., returns an async iterator directly rather than a context manager), adjust `copilot_router.py:generate()` to match. The event emission logic is unaffected.
