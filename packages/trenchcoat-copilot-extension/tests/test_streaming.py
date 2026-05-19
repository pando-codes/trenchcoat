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
