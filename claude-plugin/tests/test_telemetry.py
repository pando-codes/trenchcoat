"""
Tests for the telemetry engine and hook scripts.

Focus areas:
- Regression: write_event / flush_push_queue must not raise NameError after the
  credentials-to-env-vars refactor left bare 'config' references in those functions.
- Core pipeline: events are written to JSONL and queued for push iff api_key is set.
- Hook integration: every hook script exits 0 with valid input.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

PLUGIN_ROOT = Path(__file__).parent.parent
PLUGIN_LIB = PLUGIN_ROOT / "lib"
PLUGIN_HOOKS = PLUGIN_ROOT / "hooks"

sys.path.insert(0, str(PLUGIN_LIB))
import telemetry


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_telemetry(tmp_path, monkeypatch):
    """Redirect every module-level path constant to a throwaway temp dir."""
    td = tmp_path / "trenchcoat"
    td.mkdir()
    (td / ".pending").mkdir()

    monkeypatch.setattr(telemetry, "TRENCHCOAT_DIR", td)
    monkeypatch.setattr(telemetry, "CONFIG_PATH", td / "config.json")
    monkeypatch.setattr(telemetry, "SESSIONS_PATH", td / "sessions.json")
    monkeypatch.setattr(telemetry, "PENDING_DIR", td / ".pending")
    monkeypatch.setattr(telemetry, "PUSH_QUEUE_PATH", td / ".push_queue.jsonl")
    # Reset per-process seq counter so tests are order-independent
    monkeypatch.setattr(telemetry, "_seq_counter", 0)

    return td


@pytest.fixture()
def with_api_key():
    with patch.dict(os.environ, {"TRENCHCOAT_API_KEY": "ct_live_testkey123"}):
        yield


@pytest.fixture()
def without_api_key():
    env = {k: v for k, v in os.environ.items() if k != "TRENCHCOAT_API_KEY"}
    with patch.dict(os.environ, env, clear=True):
        yield


# ---------------------------------------------------------------------------
# _get_credentials
# ---------------------------------------------------------------------------

class TestGetCredentials:
    def test_returns_none_when_env_absent(self, without_api_key):
        api_key, api_url = telemetry._get_credentials()
        assert api_key is None
        assert api_url == "https://app.trenchcoat.io"

    def test_returns_key_from_env(self, with_api_key):
        api_key, _ = telemetry._get_credentials()
        assert api_key == "ct_live_testkey123"

    def test_custom_api_url(self):
        with patch.dict(os.environ, {
            "TRENCHCOAT_API_KEY": "k",
            "TRENCHCOAT_API_URL": "https://self-hosted.example.com",
        }):
            _, api_url = telemetry._get_credentials()
        assert api_url == "https://self-hosted.example.com"

    def test_default_url_when_only_key_set(self, with_api_key):
        env = {k: v for k, v in os.environ.items() if k != "TRENCHCOAT_API_URL"}
        with patch.dict(os.environ, env, clear=True):
            with patch.dict(os.environ, {"TRENCHCOAT_API_KEY": "k"}):
                _, api_url = telemetry._get_credentials()
        assert api_url == "https://app.trenchcoat.io"


# ---------------------------------------------------------------------------
# write_event — regression + happy path
# ---------------------------------------------------------------------------

class TestWriteEvent:
    def _read_jsonl(self, td):
        files = list(td.glob("events-*.jsonl"))
        assert len(files) == 1
        return [json.loads(l) for l in files[0].read_text().splitlines() if l.strip()]

    def test_completes_without_error_no_api_key(self, isolated_telemetry, without_api_key):
        """Regression: must not raise NameError when no api_key and no webhook."""
        telemetry.write_event("session_start", "s1", {"cwd": "/tmp"})
        events = self._read_jsonl(isolated_telemetry)
        assert events[0]["event"] == "session_start"

    def test_completes_without_error_with_api_key(self, isolated_telemetry, with_api_key):
        """Regression: must not raise NameError when api_key IS set."""
        telemetry.write_event("tool_start", "s1", {"tool_name": "Bash"})
        events = self._read_jsonl(isolated_telemetry)
        assert len(events) == 1

    def test_does_not_queue_without_api_key(self, isolated_telemetry, without_api_key):
        telemetry.write_event("session_start", "s1", {})
        assert not (isolated_telemetry / ".push_queue.jsonl").exists()

    def test_queues_event_with_api_key(self, isolated_telemetry, with_api_key):
        telemetry.write_event("session_start", "s1", {})
        queue = isolated_telemetry / ".push_queue.jsonl"
        assert queue.exists()
        queued = [json.loads(l) for l in queue.read_text().splitlines() if l.strip()]
        assert len(queued) == 1
        assert queued[0]["session_id"] == "s1"

    def test_event_type_mapped_in_queue(self, isolated_telemetry, with_api_key):
        telemetry.write_event("tool_start", "s1", {})
        queue = isolated_telemetry / ".push_queue.jsonl"
        queued = [json.loads(l) for l in queue.read_text().splitlines() if l.strip()]
        assert queued[0]["event"] == "tool_use"  # mapped from tool_start

    def test_unmapped_event_type_passes_through(self, isolated_telemetry, with_api_key):
        telemetry.write_event("session_start", "s1", {})
        queue = isolated_telemetry / ".push_queue.jsonl"
        queued = [json.loads(l) for l in queue.read_text().splitlines() if l.strip()]
        assert queued[0]["event"] == "session_start"

    def test_webhook_fired_when_configured(self, isolated_telemetry, without_api_key):
        """Regression: webhook_url must be read from load_config(), not bare 'config'."""
        config = {**telemetry.DEFAULT_CONFIG, "webhook_url": "http://wh.test/hook"}
        (isolated_telemetry / "config.json").write_text(json.dumps(config))
        with patch.object(telemetry, "_fire_webhook") as mock_wh:
            telemetry.write_event("session_end", "s1", {})
            mock_wh.assert_called_once()

    def test_no_webhook_when_not_configured(self, isolated_telemetry, without_api_key):
        with patch.object(telemetry, "_fire_webhook") as mock_wh:
            telemetry.write_event("session_end", "s1", {})
            mock_wh.assert_not_called()

    def test_multiple_events_append_to_same_file(self, isolated_telemetry, without_api_key):
        telemetry.write_event("session_start", "s1", {})
        telemetry.write_event("tool_start", "s1", {"tool_name": "Bash"})
        events = self._read_jsonl(isolated_telemetry)
        assert len(events) == 2

    def test_event_structure_has_required_fields(self, isolated_telemetry, without_api_key):
        telemetry.write_event("session_start", "s1", {"cwd": "/tmp"})
        events = self._read_jsonl(isolated_telemetry)
        e = events[0]
        assert "ts" in e
        assert "event" in e
        assert "session_id" in e
        assert "seq" in e
        assert "data" in e
        assert e["data"]["cwd"] == "/tmp"


# ---------------------------------------------------------------------------
# flush_push_queue — regression + batch logic
# ---------------------------------------------------------------------------

class TestFlushPushQueue:
    def _write_queue(self, td, n=3):
        events = [
            {"ts": "2026-01-01T00:00:00.000+00:00", "event": "session_start",
             "session_id": f"s{i}", "seq": i, "data": {}}
            for i in range(n)
        ]
        (td / ".push_queue.jsonl").write_text(
            "\n".join(json.dumps(e) for e in events) + "\n"
        )
        return events

    def test_skips_when_no_api_key(self, isolated_telemetry, without_api_key):
        result = telemetry.flush_push_queue()
        assert result["status"] == "skipped"
        assert "TRENCHCOAT_API_KEY" in result["reason"]

    def test_ok_when_queue_file_absent(self, isolated_telemetry, with_api_key):
        result = telemetry.flush_push_queue()
        assert result == {"status": "ok", "pushed": 0}

    def test_ok_when_queue_file_empty(self, isolated_telemetry, with_api_key):
        (isolated_telemetry / ".push_queue.jsonl").write_text("")
        result = telemetry.flush_push_queue()
        assert result["status"] == "ok"
        assert result["pushed"] == 0

    def test_reads_batch_size_from_config_not_bare_config(self, isolated_telemetry, with_api_key):
        """Regression: batch_size must come from load_config(), not a bare 'config' variable."""
        config = {**telemetry.DEFAULT_CONFIG, "push_batch_size": 2}
        (isolated_telemetry / "config.json").write_text(json.dumps(config))
        self._write_queue(isolated_telemetry, n=5)

        batches = []
        with patch.object(telemetry, "_post_batch", side_effect=lambda url, key, b: batches.append(b)):
            result = telemetry.flush_push_queue()

        assert result["pushed"] == 5
        assert len(batches) == 3  # ceil(5/2) with batch_size=2

    def test_clears_queue_on_full_success(self, isolated_telemetry, with_api_key):
        self._write_queue(isolated_telemetry)
        with patch.object(telemetry, "_post_batch"):
            telemetry.flush_push_queue()
        assert not (isolated_telemetry / ".push_queue.jsonl").exists()

    def test_preserves_queue_on_total_failure(self, isolated_telemetry, with_api_key):
        self._write_queue(isolated_telemetry)
        with patch.object(telemetry, "_post_batch", side_effect=RuntimeError("network error")):
            result = telemetry.flush_push_queue()
        assert result["status"] == "error"
        assert (isolated_telemetry / ".push_queue.jsonl").exists()

    def test_partial_success_rewrites_remaining(self, isolated_telemetry, with_api_key):
        """On partial failure, unsent tail events are kept in the queue."""
        config = {**telemetry.DEFAULT_CONFIG, "push_batch_size": 2}
        (isolated_telemetry / "config.json").write_text(json.dumps(config))
        self._write_queue(isolated_telemetry, n=4)  # 2 batches of 2

        calls = [0]
        def fail_second_batch(url, key, batch):
            calls[0] += 1
            if calls[0] == 2:
                raise RuntimeError("transient error")

        with patch.object(telemetry, "_post_batch", side_effect=fail_second_batch):
            result = telemetry.flush_push_queue()

        assert result["status"] == "partial"
        assert result["pushed"] == 2   # first batch succeeded
        assert result["total"] == 4
        # Remaining unsent events are still in the queue
        assert (isolated_telemetry / ".push_queue.jsonl").exists()

    def test_returns_pushed_count(self, isolated_telemetry, with_api_key):
        self._write_queue(isolated_telemetry, n=3)
        with patch.object(telemetry, "_post_batch"):
            result = telemetry.flush_push_queue()
        assert result["pushed"] == 3
        assert result["total"] == 3


# ---------------------------------------------------------------------------
# sanitize_tool_input / sanitize_tool_result
# ---------------------------------------------------------------------------

class TestSanitize:
    def test_input_truncates_long_string(self):
        config = {"privacy": {"tool_input_preview_chars": 10}}
        result = telemetry.sanitize_tool_input("x" * 20, config)
        assert result == "x" * 10 + "..."

    def test_input_returns_none_for_none(self):
        assert telemetry.sanitize_tool_input(None, {}) is None

    def test_input_serialises_dict(self):
        config = {"privacy": {"tool_input_preview_chars": 1000}}
        result = telemetry.sanitize_tool_input({"cmd": "echo hi"}, config)
        assert '"cmd"' in result

    def test_input_no_truncation_when_short(self):
        config = {"privacy": {"tool_input_preview_chars": 200}}
        result = telemetry.sanitize_tool_input("hi", config)
        assert result == "hi"
        assert "..." not in result

    def test_result_none(self):
        result = telemetry.sanitize_tool_result(None)
        assert result["size"] == 0
        assert result["is_error"] is None
        assert result["error_preview"] is None

    def test_result_str(self):
        result = telemetry.sanitize_tool_result("hello")
        assert result["size"] == 5
        # Plain string responses give us no way to determine error state.
        assert result["is_error"] is None
        assert result["error_preview"] is None

    def test_result_dict(self):
        result = telemetry.sanitize_tool_result({"a": 1, "b": 2})
        assert result["size"] > 0
        # No is_error key on the response → unknown.
        assert result["is_error"] is None
        assert result["error_preview"] is None

    def test_result_never_includes_content(self):
        result = telemetry.sanitize_tool_result("secret content")
        assert "secret" not in str(result)

    # --- is_error / error_preview behaviour ---

    def test_result_dict_with_is_error_true_reads_content(self):
        result = telemetry.sanitize_tool_result(
            {"is_error": True, "content": "Command failed: file not found"}
        )
        assert result["is_error"] is True
        assert result["error_preview"] == "Command failed: file not found"

    def test_result_dict_with_is_error_false_returns_no_preview(self):
        result = telemetry.sanitize_tool_result({"is_error": False, "content": "ok"})
        assert result["is_error"] is False
        assert result["error_preview"] is None

    def test_result_dict_without_is_error_field_is_unknown(self):
        result = telemetry.sanitize_tool_result({"content": "ok"})
        assert result["is_error"] is None
        assert result["error_preview"] is None

    def test_result_string_has_unknown_is_error(self):
        result = telemetry.sanitize_tool_result("hello")
        assert result["is_error"] is None
        assert result["error_preview"] is None

    def test_result_dict_with_is_error_true_reads_error_key(self):
        result = telemetry.sanitize_tool_result({"is_error": True, "error": "boom"})
        assert result["is_error"] is True
        assert result["error_preview"] == "boom"

    def test_result_dict_with_is_error_true_reads_message_key(self):
        result = telemetry.sanitize_tool_result({"is_error": True, "message": "something broke"})
        assert result["is_error"] is True
        assert result["error_preview"] == "something broke"

    def test_result_error_preview_truncated_to_200_chars(self):
        long_msg = "x" * 500
        result = telemetry.sanitize_tool_result({"is_error": True, "content": long_msg})
        assert result["is_error"] is True
        assert result["error_preview"] is not None
        assert len(result["error_preview"]) == 200
        assert result["error_preview"] == "x" * 200

    def test_result_error_preview_prefers_content_over_error(self):
        result = telemetry.sanitize_tool_result(
            {"is_error": True, "content": "from content", "error": "from error"}
        )
        assert result["error_preview"] == "from content"

    def test_result_is_error_true_with_no_string_fields_yields_none_preview(self):
        result = telemetry.sanitize_tool_result({"is_error": True, "code": 500})
        assert result["is_error"] is True
        assert result["error_preview"] is None


# ---------------------------------------------------------------------------
# load_config / is_enabled
# ---------------------------------------------------------------------------

class TestLoadConfig:
    def test_returns_defaults_when_no_file(self, isolated_telemetry):
        config = telemetry.load_config()
        assert config["enabled"] is True
        assert config["retention_days"] == 30

    def test_writes_config_file_on_first_load(self, isolated_telemetry):
        telemetry.load_config()
        assert (isolated_telemetry / "config.json").exists()

    def test_reads_existing_config(self, isolated_telemetry):
        custom = {**telemetry.DEFAULT_CONFIG, "retention_days": 7}
        (isolated_telemetry / "config.json").write_text(json.dumps(custom))
        config = telemetry.load_config()
        assert config["retention_days"] == 7

    def test_falls_back_to_defaults_on_corrupt_json(self, isolated_telemetry):
        (isolated_telemetry / "config.json").write_text("not json {{{")
        config = telemetry.load_config()
        assert config["enabled"] is True

    def test_is_enabled_true_by_default(self, isolated_telemetry):
        assert telemetry.is_enabled() is True

    def test_is_enabled_respects_config(self, isolated_telemetry):
        (isolated_telemetry / "config.json").write_text(json.dumps({**telemetry.DEFAULT_CONFIG, "enabled": False}))
        assert telemetry.is_enabled() is False


# ---------------------------------------------------------------------------
# update_session_index
# ---------------------------------------------------------------------------

class TestSessionIndex:
    def test_creates_new_entry(self, isolated_telemetry):
        telemetry.update_session_index("s1", {"started_at": "2026-01-01T00:00:00Z", "status": "active"})
        sessions = json.loads((isolated_telemetry / "sessions.json").read_text())
        assert sessions["s1"]["status"] == "active"

    def test_merges_existing_entry(self, isolated_telemetry):
        telemetry.update_session_index("s1", {"started_at": "2026-01-01T00:00:00Z"})
        telemetry.update_session_index("s1", {"status": "ended", "ended_at": "2026-01-01T01:00:00Z"})
        sessions = json.loads((isolated_telemetry / "sessions.json").read_text())
        assert sessions["s1"]["started_at"] == "2026-01-01T00:00:00Z"
        assert sessions["s1"]["status"] == "ended"

    def test_preserves_other_sessions(self, isolated_telemetry):
        telemetry.update_session_index("s1", {"started_at": "t1"})
        telemetry.update_session_index("s2", {"started_at": "t2"})
        sessions = json.loads((isolated_telemetry / "sessions.json").read_text())
        assert "s1" in sessions
        assert "s2" in sessions


# ---------------------------------------------------------------------------
# push_pending / pop_pending
# ---------------------------------------------------------------------------

class TestParseEdgeLabel:
    def test_parses_each_valid_label(self):
        for label in ("delegate", "verify", "critique"):
            got, rest = telemetry.parse_edge_label(f"[tc:{label}] go do it")
            assert got == label
            assert "[tc:" not in rest

    def test_is_case_insensitive(self):
        got, _ = telemetry.parse_edge_label("[TC:Verify] check this")
        assert got == "verify"

    def test_matches_mid_prompt(self):
        got, rest = telemetry.parse_edge_label("please [tc:critique] this patch")
        assert got == "critique"
        assert rest == "please this patch"

    def test_preserves_newlines_in_multiline_prompt(self):
        got, rest = telemetry.parse_edge_label(
            "[tc:verify] first line\n\n  indented second"
        )
        assert got == "verify"
        assert rest == "first line\n\n  indented second"

    def test_malformed_markers_are_ignored(self):
        for bad in (
            "[tc:] hello",
            "[tc verify] hello",
            "[tc:verify hello",
            "tc:verify] hello",
        ):
            got, rest = telemetry.parse_edge_label(bad)
            assert got is None, f"{bad!r} should not parse"
            assert rest == bad, f"{bad!r} text must be unchanged"

    def test_unknown_label_is_ignored_and_text_untouched(self):
        got, rest = telemetry.parse_edge_label("[tc:bogus] hello")
        assert got is None
        assert rest == "[tc:bogus] hello"

    def test_no_marker_returns_none_and_original_text(self):
        got, rest = telemetry.parse_edge_label("just a prompt")
        assert got is None
        assert rest == "just a prompt"

    def test_first_match_wins(self):
        got, _ = telemetry.parse_edge_label("[tc:verify] then [tc:delegate]")
        assert got == "verify"

    def test_handles_none_and_non_string(self):
        assert telemetry.parse_edge_label(None) == (None, "")
        assert telemetry.parse_edge_label(123)[0] is None


class TestPendingEdgeLabel:
    def test_push_with_edge_label_roundtrip(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-1", agent_id="ag-1", edge_label="verify")
        entry = telemetry.pop_pending("s1", "Agent")
        assert entry["edge_label"] == "verify"
        assert entry["agent_id"] == "ag-1"

    def test_push_without_edge_label_has_no_key(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-1")
        entry = telemetry.pop_pending("s1", "Agent")
        assert "edge_label" not in entry


class TestPendingStack:
    def test_push_then_pop_roundtrip(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-abc")
        entry = telemetry.pop_pending("s1", "Bash")
        assert entry is not None
        assert entry["tool_name"] == "Bash"
        assert entry["correlation_id"] == "corr-abc"

    def test_pop_removes_entry(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-abc")
        telemetry.pop_pending("s1", "Bash")
        assert telemetry.pop_pending("s1", "Bash") is None

    def test_pop_returns_none_for_missing_session(self, isolated_telemetry):
        assert telemetry.pop_pending("no-such-session", "Bash") is None

    def test_pop_returns_none_for_wrong_tool(self, isolated_telemetry):
        telemetry.push_pending("s1", "Read", "corr-xyz")
        assert telemetry.pop_pending("s1", "Bash") is None

    def test_lifo_order(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "first")
        telemetry.push_pending("s1", "Bash", "second")
        entry = telemetry.pop_pending("s1", "Bash")
        assert entry["correlation_id"] == "second"

    def test_multiple_tool_types_independent(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "bash-1")
        telemetry.push_pending("s1", "Read", "read-1")
        bash_entry = telemetry.pop_pending("s1", "Bash")
        assert bash_entry["correlation_id"] == "bash-1"
        read_entry = telemetry.pop_pending("s1", "Read")
        assert read_entry["correlation_id"] == "read-1"

    def test_push_with_agent_id_roundtrip(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-xyz", agent_id="agt-001")
        entry = telemetry.pop_pending("s1", "Agent")
        assert entry is not None
        assert entry["agent_id"] == "agt-001"

    def test_push_without_agent_id_has_no_agent_id_key(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-abc")
        entry = telemetry.pop_pending("s1", "Bash")
        assert "agent_id" not in entry


# ---------------------------------------------------------------------------
# tool_use_id-keyed pending correlation
# ---------------------------------------------------------------------------

class TestPendingByToolUseId:
    def test_pops_by_tool_use_id_regardless_of_order(self, isolated_telemetry):
        """The case LIFO gets wrong: two Agent calls, first-started finishes first."""
        telemetry.push_pending("s1", "Agent", "corr-a", tool_use_id="toolu_A", agent_id="ag-a")
        telemetry.push_pending("s1", "Agent", "corr-b", tool_use_id="toolu_B", agent_id="ag-b")

        first = telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_A")
        assert first["agent_id"] == "ag-a", "must pop the matching entry, not the LIFO top"

        second = telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_B")
        assert second["agent_id"] == "ag-b"

    def test_falls_back_to_lifo_when_no_tool_use_id(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-1")
        telemetry.push_pending("s1", "Bash", "corr-2")
        assert telemetry.pop_pending("s1", "Bash")["correlation_id"] == "corr-2"

    def test_unknown_tool_use_id_returns_none_without_consuming(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-a", tool_use_id="toolu_A")
        assert telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_ZZZ") is None
        assert telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_A") is not None

    def test_tool_use_id_is_persisted_on_the_entry(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-a", tool_use_id="toolu_A")
        assert telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_A")["tool_use_id"] == "toolu_A"

    def test_concurrent_pushes_lose_no_entries(self, isolated_telemetry):
        """Unlocked read-modify-write loses updates; flock must not."""
        import threading
        def push(i):
            telemetry.push_pending("s1", "Bash", f"corr-{i}", tool_use_id=f"toolu_{i}")
        threads = [threading.Thread(target=push, args=(i,)) for i in range(25)]
        for t in threads: t.start()
        for t in threads: t.join()
        found = sum(1 for i in range(25)
                    if telemetry.pop_pending("s1", "Bash", tool_use_id=f"toolu_{i}") is not None)
        assert found == 25, f"lost {25 - found} entries to a race"


# ---------------------------------------------------------------------------
# peek_pending_by_tool
# ---------------------------------------------------------------------------

class TestPeekPendingByTool:
    def test_peek_returns_entry_without_removing(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-abc", agent_id="agt-1")
        peeked = telemetry.peek_pending_by_tool("s1", "Agent")
        assert peeked is not None
        assert peeked["agent_id"] == "agt-1"
        # Entry still present after peek
        popped = telemetry.pop_pending("s1", "Agent")
        assert popped is not None

    def test_peek_returns_none_when_no_match(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-xyz")
        assert telemetry.peek_pending_by_tool("s1", "Agent") is None

    def test_peek_returns_none_for_missing_session(self, isolated_telemetry):
        assert telemetry.peek_pending_by_tool("no-session", "Agent") is None

    def test_peek_returns_most_recent_match(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-1", agent_id="agt-old")
        telemetry.push_pending("s1", "Agent", "corr-2", agent_id="agt-new")
        peeked = telemetry.peek_pending_by_tool("s1", "Agent")
        assert peeked["agent_id"] == "agt-new"


# ---------------------------------------------------------------------------
# cleanup_old_events
# ---------------------------------------------------------------------------

class TestCleanupOldEvents:
    def test_deletes_files_older_than_retention(self, isolated_telemetry):
        old = isolated_telemetry / "events-2020-01-01.jsonl"
        recent = isolated_telemetry / f"events-{telemetry._today_str()}.jsonl"
        old.write_text("")
        recent.write_text("")

        count = telemetry.cleanup_old_events(retention_days=30)

        assert count == 1
        assert not old.exists()
        assert recent.exists()

    def test_keeps_recent_files(self, isolated_telemetry):
        recent = isolated_telemetry / f"events-{telemetry._today_str()}.jsonl"
        recent.write_text("")
        count = telemetry.cleanup_old_events(retention_days=30)
        assert count == 0
        assert recent.exists()

    def test_returns_zero_when_nothing_to_delete(self, isolated_telemetry):
        assert telemetry.cleanup_old_events(retention_days=30) == 0


# ---------------------------------------------------------------------------
# base_agent_fields
# ---------------------------------------------------------------------------

class TestSanitizeAgentResult:
    SYNC = {
        "status": "completed", "agentId": "ag-1", "agentType": "general-purpose",
        "resolvedModel": "claude-haiku-4-5-20251001",
        "totalDurationMs": 48262, "totalTokens": 36922, "totalToolUseCount": 15,
        "toolStats": {"readCount": 2, "bashCount": 6},
        "prompt": "SECRET PROMPT TEXT", "content": "SECRET CONTENT",
    }
    ASYNC = {
        "isAsync": True, "status": "async_launched", "agentId": "ag-2",
        "description": "SECRET DESCRIPTION", "prompt": "SECRET PROMPT",
        "outputFile": "/tmp/secret-path.output",
    }

    def test_extracts_sync_metrics(self):
        got = telemetry.sanitize_agent_result(self.SYNC)
        assert got["agentId"] == "ag-1"
        assert got["totalTokens"] == 36922
        assert got["totalDurationMs"] == 48262
        assert got["toolStats"] == {"readCount": 2, "bashCount": 6}
        assert got["resolvedModel"] == "claude-haiku-4-5-20251001"

    def test_never_leaks_prompt_content_description_or_path(self):
        for payload in (self.SYNC, self.ASYNC):
            got = telemetry.sanitize_agent_result(payload)
            blob = json.dumps(got)
            for banned in ("SECRET", "outputFile", "description", "prompt", "content"):
                assert banned not in blob, f"{banned} leaked: {blob}"

    def test_async_shape_yields_only_present_fields(self):
        got = telemetry.sanitize_agent_result(self.ASYNC)
        assert got["agentId"] == "ag-2"
        assert got["isAsync"] is True
        assert got["status"] == "async_launched"
        assert "totalTokens" not in got

    def test_non_dict_response_is_empty(self):
        assert telemetry.sanitize_agent_result("just a string") == {}
        assert telemetry.sanitize_agent_result(None) == {}


class TestBaseAgentFields:
    def test_extracts_both_when_present(self):
        got = telemetry.base_agent_fields({"agent_id": "ag-1", "agent_type": "Explore"})
        assert got == {"origin_agent_id": "ag-1", "origin_agent_type": "Explore"}

    def test_empty_when_main_thread(self):
        assert telemetry.base_agent_fields({"session_id": "s"}) == {}

    def test_agent_type_alone_is_not_a_subagent_signal(self):
        """--agent sessions set agent_type on the MAIN thread; agent_id is the real signal."""
        assert telemetry.base_agent_fields({"agent_type": "general-purpose"}) == {}


# ---------------------------------------------------------------------------
# parse_agent_transcript
# ---------------------------------------------------------------------------

class TestParseAgentTranscript:
    def _write_transcript(self, tmp_path, entries):
        f = tmp_path / "transcript.jsonl"
        f.write_text("\n".join(json.dumps(e) for e in entries) + "\n")
        return str(f)

    def test_returns_empty_dict_for_missing_file(self):
        result = telemetry.parse_agent_transcript("/nonexistent/path.jsonl")
        assert result == {}

    def test_counts_tool_uses(self, tmp_path):
        entries = [
            {"type": "assistant", "message": {
                "model": "claude-sonnet",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "content": [
                    {"type": "tool_use", "name": "Bash"},
                    {"type": "tool_use", "name": "Read"},
                    {"type": "tool_use", "name": "Bash"},
                ],
            }},
        ]
        path = self._write_transcript(tmp_path, entries)
        result = telemetry.parse_agent_transcript(path)
        assert result["tool_counts"]["Bash"] == 2
        assert result["tool_counts"]["Read"] == 1
        assert result["total_tools"] == 3

    def test_sums_tokens(self, tmp_path):
        entries = [
            {"type": "assistant", "message": {
                "model": "claude-sonnet",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "content": [],
            }},
            {"type": "assistant", "message": {
                "model": "claude-sonnet",
                "usage": {"input_tokens": 200, "output_tokens": 75},
                "content": [],
            }},
        ]
        path = self._write_transcript(tmp_path, entries)
        result = telemetry.parse_agent_transcript(path)
        assert result["input_tokens"] == 300
        assert result["output_tokens"] == 125
        assert result["turns"] == 2

    def test_skips_non_assistant_entries(self, tmp_path):
        entries = [
            {"type": "user", "message": {"content": "hello"}},
            {"type": "assistant", "message": {
                "model": "m", "usage": {"input_tokens": 10, "output_tokens": 5},
                "content": [],
            }},
        ]
        path = self._write_transcript(tmp_path, entries)
        result = telemetry.parse_agent_transcript(path)
        assert result["turns"] == 1

    def test_handles_malformed_lines(self, tmp_path):
        f = tmp_path / "transcript.jsonl"
        f.write_text('not json\n{"type":"assistant","message":{"model":"m","usage":{},"content":[]}}\n')
        result = telemetry.parse_agent_transcript(str(f))
        assert result["turns"] == 1


# ---------------------------------------------------------------------------
# Hook integration tests — run actual scripts as subprocesses
# ---------------------------------------------------------------------------

class TestHookIntegration:
    """Run each hook with valid stdin and assert exit 0.

    HOME is overridden to a temp dir so hooks write to an isolated telemetry dir
    rather than the real ~/.claude/trenchcoat.
    """

    def _run_hook(self, tmp_path, hook_name, stdin_data, extra_env=None):
        env = {
            k: v for k, v in os.environ.items()
            if k not in ("TRENCHCOAT_API_KEY", "TRENCHCOAT_API_URL", "TRENCHCOAT_EVAL_ID", "TRENCHCOAT_EVAL_VARIANT")
        }
        env["HOME"] = str(tmp_path)
        if extra_env:
            env.update(extra_env)

        hook_path = PLUGIN_HOOKS / hook_name
        result = subprocess.run(
            [sys.executable, str(hook_path)],
            input=json.dumps(stdin_data),
            capture_output=True,
            text=True,
            env=env,
        )
        return result

    def test_session_start_exits_zero(self, tmp_path):
        r = self._run_hook(tmp_path, "session_start.py", {"session_id": "test-s", "cwd": "/tmp"})
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_pre_tool_use_exits_zero(self, tmp_path):
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash", "tool_input": {"command": "echo hi"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_post_tool_use_exits_zero(self, tmp_path):
        """Regression: crashed with NameError on config.get('webhook_url')."""
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_session_end_exits_zero(self, tmp_path):
        """Regression: crashed with NameError on config.get('retention_days')."""
        r = self._run_hook(tmp_path, "session_end.py", {"session_id": "test-s"})
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_stop_exits_zero(self, tmp_path):
        r = self._run_hook(tmp_path, "stop.py", {
            "session_id": "test-s", "stop_hook_reason": "end_turn",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_subagent_stop_exits_zero(self, tmp_path):
        r = self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "test-s", "agent_type": "general-purpose",
            "stop_hook_active": False,
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_subagent_stop_uses_payload_agent_id(self, tmp_path):
        r = self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "ss-1", "agent_id": "ag-real", "agent_type": "Explore",
            "stop_hook_active": False,
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_stop")
        assert ev["data"]["agent_id"] == "ag-real"

    def test_subagent_stop_emits_stop_hook_active_not_reason(self, tmp_path):
        self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "ss-2", "agent_id": "ag-x", "agent_type": "Explore",
            "stop_hook_active": True,
        })
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_stop")
        assert ev["data"]["stop_hook_active"] is True
        assert "reason" not in ev["data"], "the nonexistent stop_hook_reason key must be gone"

    def test_subagent_stop_without_agent_id_omits_it(self, tmp_path):
        self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "ss-3", "agent_type": "Explore", "stop_hook_active": False,
        })
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_stop")
        assert "agent_id" not in ev["data"]

    def test_user_prompt_submit_exits_zero(self, tmp_path):
        r = self._run_hook(tmp_path, "user_prompt_submit.py", {
            "session_id": "test-s", "prompt": "Hello Claude",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

    def test_user_prompt_submit_clears_active_context(self, tmp_path):
        """UserPromptSubmit → active context file removed."""
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        tc_dir.mkdir(parents=True, exist_ok=True)
        ctx_file = tc_dir / ".active_context_test-s.json"
        ctx_file.write_text('{"spawner_id": "act-abc", "spawner_type": "skill", "spawner_name": "test:skill", "activated_at": "2026-05-20T00:00:00.000+00:00"}')
        assert ctx_file.exists()

        r = self._run_hook(tmp_path, "user_prompt_submit.py", {
            "session_id": "test-s",
            "prompt": "do something",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        assert not ctx_file.exists(), "active context must be cleared on new user prompt"

    def test_post_tool_use_queues_event_when_api_key_set(self, tmp_path):
        """End-to-end: api_key set → event written to push queue."""
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        }, extra_env={"TRENCHCOAT_API_KEY": "ct_live_test"})
        assert r.returncode == 0
        queue = tmp_path / ".claude" / "trenchcoat" / ".push_queue.jsonl"
        assert queue.exists(), "Push queue must be created when api_key is set"
        events = [json.loads(l) for l in queue.read_text().splitlines() if l.strip()]
        assert len(events) == 1
        assert events[0]["event"] == "tool_result"  # tool_end → tool_result mapping

    def test_post_tool_use_no_queue_without_api_key(self, tmp_path):
        """End-to-end: no api_key → no push queue created."""
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        })
        assert r.returncode == 0
        queue = tmp_path / ".claude" / "trenchcoat" / ".push_queue.jsonl"
        assert not queue.exists()

    def test_pre_tool_use_skill_tool_emits_skill_use_event(self, tmp_path):
        """Skill tool call → skill_use event written to JSONL."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": "help me plan"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        jsonl_files = list(tc_dir.glob("events-*.jsonl"))
        assert len(jsonl_files) == 1
        events = [json.loads(l) for l in jsonl_files[0].read_text().splitlines() if l.strip()]
        skill_events = [e for e in events if e["event"] == "skill_use"]
        assert len(skill_events) == 1
        assert skill_events[0]["data"]["skill_name"] == "superpowers:brainstorming"
        assert "activation_id" in skill_events[0]["data"]

    def test_pre_tool_use_skill_tool_writes_active_context_file(self, tmp_path):
        """Skill tool call → .active_context_{session_id}.json written."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": ""},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        ctx_file = tmp_path / ".claude" / "trenchcoat" / ".active_context_test-s.json"
        assert ctx_file.exists(), "active context file must be written"
        ctx = json.loads(ctx_file.read_text())
        assert ctx["spawner_name"] == "superpowers:brainstorming"
        assert ctx["spawner_type"] == "skill"
        assert "spawner_id" in ctx

    def test_pre_tool_use_non_skill_tool_with_active_context_tagged(self, tmp_path):
        """Non-Skill tool call when context is active → spawner_id in event data."""
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": ""},
        })
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Read",
            "tool_input": {"file_path": "/tmp/foo.py"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        read_starts = [e for e in events if e["event"] == "tool_start" and e["data"].get("tool_name") == "Read"]
        assert len(read_starts) == 1
        assert "spawner_id" in read_starts[0]["data"]
        assert read_starts[0]["data"]["spawner_type"] == "skill"

    def test_pre_tool_use_non_skill_without_context_not_tagged(self, tmp_path):
        """Non-Skill tool call with no active context → no spawner_id in event data."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        tool_starts = [e for e in events if e["event"] == "tool_start"]
        assert len(tool_starts) == 1
        assert "spawner_id" not in tool_starts[0]["data"]

    def test_post_tool_use_tags_spawner_when_context_set(self, tmp_path):
        """PostToolUse with active context → spawner_id + spawner_type in tool_end event."""
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        tc_dir.mkdir(parents=True, exist_ok=True)
        (tc_dir / ".active_context_test-s.json").write_text(
            '{"spawner_id": "act-xyz", "spawner_type": "skill", "spawner_name": "test:skill", "activated_at": "2026-05-20T00:00:00.000+00:00"}'
        )
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        tool_ends = [e for e in events if e["event"] == "tool_end"]
        assert len(tool_ends) == 1
        assert tool_ends[0]["data"].get("spawner_id") == "act-xyz"
        assert tool_ends[0]["data"].get("spawner_type") == "skill"

    def test_post_tool_use_no_tag_without_context(self, tmp_path):
        """PostToolUse with no active context → no spawner_id in tool_end event."""
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        tool_ends = [e for e in events if e["event"] == "tool_end"]
        assert len(tool_ends) == 1
        assert "spawner_id" not in tool_ends[0]["data"]

    def _read_events(self, tmp_path):
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        lines = []
        for f in sorted(tc_dir.glob("events-*.jsonl")):
            lines.extend(json.loads(l) for l in f.read_text().splitlines() if l.strip())
        return lines

    def test_agent_tool_end_carries_agent_id(self, tmp_path):
        """PreToolUse(Agent) mints agent_id; PostToolUse must copy it onto tool_end."""
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "do the thing"},
        })
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "do the thing"},
            "tool_response": "ok",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

        events = self._read_events(tmp_path)
        starts = [e for e in events if e["event"] == "tool_start"]
        ends = [e for e in events if e["event"] == "tool_end"]
        assert starts and ends
        assert starts[0]["data"].get("agent_id"), "tool_start should mint agent_id"
        assert ends[0]["data"].get("agent_id") == starts[0]["data"]["agent_id"], \
            "tool_end must carry the same agent_id as tool_start"

    def test_agent_tool_end_carries_result_metrics(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "m-s", "tool_name": "Agent", "tool_use_id": "toolu_M",
            "tool_input": {"description": "d", "prompt": "p"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "m-s", "tool_name": "Agent", "tool_use_id": "toolu_M",
            "tool_input": {"description": "d", "prompt": "p"},
            "tool_response": {"status": "completed", "agentId": "ag-9",
                              "totalTokens": 100, "prompt": "SECRET"},
        })
        end = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_end")
        assert end["data"]["agent_result"]["agentId"] == "ag-9"
        assert end["data"]["agent_result"]["totalTokens"] == 100
        assert "SECRET" not in json.dumps(end["data"])

    def test_non_agent_tool_end_has_no_agent_id(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash", "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        })
        ends = [e for e in self._read_events(tmp_path) if e["event"] == "tool_end"]
        assert ends and "agent_id" not in ends[0]["data"]

    def test_agent_edge_label_lands_on_start_and_end(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "[tc:verify] check the patch"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "[tc:verify] check the patch"},
            "tool_response": "ok",
        })
        events = self._read_events(tmp_path)
        start = next(e for e in events if e["event"] == "tool_start")
        end = next(e for e in events if e["event"] == "tool_end")
        assert start["data"]["edge_label"] == "verify"
        assert end["data"]["edge_label"] == "verify"
        assert "[tc:" not in (start["data"].get("input_preview") or ""), \
            "marker must be stripped from the privacy preview"

    def test_agent_without_marker_has_no_edge_label(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "no marker here"},
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert "edge_label" not in start["data"]

    def test_tool_events_carry_origin_agent(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "o-s", "tool_name": "Bash", "tool_use_id": "toolu_O",
            "tool_input": {"command": "echo hi"},
            "agent_id": "ag-child", "agent_type": "Explore",
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert start["data"]["origin_agent_id"] == "ag-child"
        assert start["data"]["origin_agent_type"] == "Explore"

    def test_main_thread_tool_events_have_no_origin_agent(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "o-s2", "tool_name": "Bash", "tool_use_id": "toolu_P",
            "tool_input": {"command": "echo hi"},
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert "origin_agent_id" not in start["data"]

    def test_marker_ignored_for_non_agent_tool(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s", "tool_name": "Bash",
            "tool_input": {"command": "echo [tc:verify]"},
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert "edge_label" not in start["data"]

    def test_session_start_records_agent_id_from_spawn_context(self, tmp_path):
        """PreToolUse(Agent) in the parent session mints agent_id and writes the
        cross-process spawn context; SessionStart for the CHILD session must
        copy that agent_id onto its session_start event so the graph's
        edge_label join (session_start.agent_id == tool_use.agent_id) has
        something to match against.
        """
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "parent-s", "tool_name": "Agent",
            "tool_input": {"description": "d", "prompt": "[tc:delegate] do the thing"},
        })
        parent_start = next(
            e for e in self._read_events(tmp_path) if e["event"] == "tool_start"
        )
        parent_agent_id = parent_start["data"]["agent_id"]
        assert parent_agent_id, "parent tool_start should mint agent_id"

        r = self._run_hook(tmp_path, "session_start.py", {
            "session_id": "child-s", "cwd": "/tmp",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"

        child_starts = [
            e for e in self._read_events(tmp_path)
            if e["event"] == "session_start" and e["session_id"] == "child-s"
        ]
        assert len(child_starts) == 1
        assert child_starts[0]["data"].get("agent_id") == parent_agent_id, \
            "session_start for the child session must carry the parent's agent_id"

    def test_session_start_records_eval_tags_from_env(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s", "cwd": "/tmp"},
                       extra_env={"TRENCHCOAT_EVAL_ID": "deep-research",
                                  "TRENCHCOAT_EVAL_VARIANT": "v3"})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert start["data"]["eval_id"] == "deep-research"
        assert start["data"]["eval_variant"] == "v3"

    def test_session_start_without_eval_env_has_no_eval_keys(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s2", "cwd": "/tmp"})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert "eval_id" not in start["data"]
        assert "eval_variant" not in start["data"]

    def test_session_start_truncates_overlong_eval_values(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s3", "cwd": "/tmp"},
                       extra_env={"TRENCHCOAT_EVAL_ID": "x" * 300})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert len(start["data"]["eval_id"]) == 128

    def test_session_start_empty_eval_env_has_no_eval_keys(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s4", "cwd": "/tmp"},
                       extra_env={"TRENCHCOAT_EVAL_ID": "", "TRENCHCOAT_EVAL_VARIANT": ""})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert "eval_id" not in start["data"]
        assert "eval_variant" not in start["data"]

    def test_session_start_truncates_overlong_eval_variant(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s5", "cwd": "/tmp"},
                       extra_env={"TRENCHCOAT_EVAL_VARIANT": "v" * 300})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert len(start["data"]["eval_variant"]) == 128

    def test_tool_use_id_emitted_and_matches_across_pair(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "t-s", "tool_name": "Bash", "tool_use_id": "toolu_X",
            "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "t-s", "tool_name": "Bash", "tool_use_id": "toolu_X",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
            "duration_ms": 42,
        })
        events = self._read_events(tmp_path)
        start = next(e for e in events if e["event"] == "tool_start")
        end = next(e for e in events if e["event"] == "tool_end")
        assert start["data"]["tool_use_id"] == "toolu_X"
        assert end["data"]["tool_use_id"] == "toolu_X"

    def test_prefers_native_duration_ms(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "t-s2", "tool_name": "Bash", "tool_use_id": "toolu_Y",
            "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "t-s2", "tool_name": "Bash", "tool_use_id": "toolu_Y",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
            "duration_ms": 1234,
        })
        end = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_end")
        assert end["data"]["duration_ms"] == 1234
        assert end["data"]["duration_source"] == "native"

    def test_falls_back_to_computed_duration(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "t-s3", "tool_name": "Bash", "tool_use_id": "toolu_Z",
            "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "t-s3", "tool_name": "Bash", "tool_use_id": "toolu_Z",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        })
        end = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_end")
        assert end["data"]["duration_source"] == "computed"
        assert end["data"]["duration_ms"] is not None

    def test_out_of_order_agent_pair_correlates_correctly(self, tmp_path):
        """Two Agent spawns; the FIRST finishes first — LIFO would mispair these."""
        for tid, prompt in (("toolu_A", "first task"), ("toolu_B", "second task")):
            self._run_hook(tmp_path, "pre_tool_use.py", {
                "session_id": "p-s", "tool_name": "Agent", "tool_use_id": tid,
                "tool_input": {"description": "d", "prompt": prompt},
            })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "p-s", "tool_name": "Agent", "tool_use_id": "toolu_A",
            "tool_input": {"description": "d", "prompt": "first task"},
            "tool_response": {"agentId": "ag-first", "status": "completed"},
        })
        events = self._read_events(tmp_path)
        starts = {e["data"]["tool_use_id"]: e for e in events if e["event"] == "tool_start"}
        end = next(e for e in events if e["event"] == "tool_end")
        assert end["data"]["tool_use_id"] == "toolu_A"
        assert end["data"]["correlation_id"] == starts["toolu_A"]["data"]["correlation_id"], \
            "tool_end must carry the correlation_id of ITS OWN tool_start"


# ---------------------------------------------------------------------------
# Active context helpers
# ---------------------------------------------------------------------------

class TestActiveContext:
    def test_write_then_read_roundtrip(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-abc", "skill", "superpowers:brainstorming")
        ctx = telemetry.read_active_context("s1")
        assert ctx is not None
        assert ctx["spawner_id"] == "act-abc"
        assert ctx["spawner_type"] == "skill"
        assert ctx["spawner_name"] == "superpowers:brainstorming"

    def test_read_returns_none_when_no_context(self, isolated_telemetry):
        assert telemetry.read_active_context("s1") is None

    def test_clear_removes_context(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-abc", "skill", "superpowers:brainstorming")
        telemetry.clear_active_context("s1")
        assert telemetry.read_active_context("s1") is None

    def test_clear_is_safe_when_no_context(self, isolated_telemetry):
        telemetry.clear_active_context("no-such-session")  # must not raise

    def test_contexts_are_session_scoped(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-1", "skill", "skill-a")
        telemetry.write_active_context("s2", "act-2", "agent", "Agent")
        assert telemetry.read_active_context("s1")["spawner_id"] == "act-1"
        assert telemetry.read_active_context("s2")["spawner_id"] == "act-2"

    def test_write_overwrites_previous(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-1", "skill", "skill-a")
        telemetry.write_active_context("s1", "act-2", "skill", "skill-b")
        ctx = telemetry.read_active_context("s1")
        assert ctx["spawner_id"] == "act-2"
        assert ctx["spawner_name"] == "skill-b"


# ---------------------------------------------------------------------------
# Agent spawn context helpers
# ---------------------------------------------------------------------------

class TestAgentSpawnContext:
    def test_write_then_read_roundtrip(self, isolated_telemetry):
        telemetry.write_agent_spawn_context("parent-s1", "agt-abc", "act-xyz", "skill")
        ctx = telemetry.read_agent_spawn_context()
        assert ctx is not None
        assert ctx["parent_session_id"] == "parent-s1"
        assert ctx["agent_id"] == "agt-abc"
        assert ctx["spawner_id"] == "act-xyz"
        assert ctx["spawner_type"] == "skill"

    def test_write_without_spawner(self, isolated_telemetry):
        telemetry.write_agent_spawn_context("parent-s1", "agt-abc", None, None)
        ctx = telemetry.read_agent_spawn_context()
        assert ctx["parent_session_id"] == "parent-s1"
        assert "spawner_id" not in ctx

    def test_read_returns_none_when_absent(self, isolated_telemetry):
        assert telemetry.read_agent_spawn_context() is None

    def test_clear_removes_file(self, isolated_telemetry):
        telemetry.write_agent_spawn_context("p", "a", None, None)
        telemetry.clear_agent_spawn_context()
        assert telemetry.read_agent_spawn_context() is None

    def test_clear_safe_when_absent(self, isolated_telemetry):
        telemetry.clear_agent_spawn_context()  # must not raise
