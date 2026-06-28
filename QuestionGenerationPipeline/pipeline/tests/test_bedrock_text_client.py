"""Unit tests for bedrock_text_client robustness (no real network).

Covers the three dry-run robustness fixes:
  - `_coerce_difficulty` normalises a model-reported difficulty to int 1..5|None
    so downstream triage never does `abs(int - str)` (difficulty bug);
  - the cold-solve prompt (v2) demands an INTEGER 1-5 only — never a word;
  - `_converse_text` retries a `ReadTimeoutError` with backoff up to
    MAX_RETRIES, then raises a named PipelineError (so a persistently-slow
    reasoning call becomes a flagged failed artifact, not a batch crash).

boto3 is mocked / time.sleep is patched so nothing leaves the machine and the
tests run instantly.
"""

import pytest
from botocore.exceptions import ReadTimeoutError, ConnectTimeoutError

import bedrock_text_client
import synthetic_prompts
from common import PipelineError


# --- _coerce_difficulty ----------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    ("easy", 2),
    ("Easy", 2),
    ("VERY EASY", 2),
    ("medium", 3),
    ("moderate", 3),
    ("hard", 4),
    ("difficult", 4),
    ("very hard", 5),
    ("3", 3),
    ("4 (hard)", 4),
    (4, 4),
    (1, 1),
    (5, 5),
    (3.0, 3),
    ("huge", None),
    ("", None),
    ("  ", None),
    (0, None),
    (6, None),
    (None, None),
    (True, None),
    (False, None),
    ([], None),
])
def test_coerce_difficulty(value, expected):
    assert bedrock_text_client._coerce_difficulty(value) == expected


def test_cold_solve_normalises_word_difficulty(monkeypatch):
    """A cold_solve response with difficulty "easy" comes back as int 2."""
    monkeypatch.setattr(
        bedrock_text_client, "_converse_text",
        lambda *a, **k: '{"answer": "12", "steps": "s", '
                        '"difficulty": "easy", "exactlyOneCorrect": true}',
    )
    out = bedrock_text_client.cold_solve("What is 6+6?", ["10", "11", "12", "13", "14"])
    assert out["status"] == "ok"
    assert out["difficulty"] == 2  # "easy" -> 2, an int


def test_cold_solve_numeric_string_difficulty(monkeypatch):
    monkeypatch.setattr(
        bedrock_text_client, "_converse_text",
        lambda *a, **k: '{"answer": "12", "steps": "s", '
                        '"difficulty": "3", "exactlyOneCorrect": true}',
    )
    out = bedrock_text_client.cold_solve("q", ["a", "b", "c", "d", "e"])
    assert out["difficulty"] == 3


# --- prompt v2 demands an integer ------------------------------------------

def test_cold_solve_prompt_v2_requires_integer_only():
    assert synthetic_prompts.COLD_SOLVE_PROMPT_VERSION == "m6-cold-solve-v2"
    prompt = synthetic_prompts.build_cold_solve_prompt(
        "What is 6+6?", ["10", "11", "12", "13", "14"]
    )
    low = prompt.lower()
    # the instruction must insist on an integer and forbid a word like 'easy'
    assert "integer 1-5 only" in low
    assert "easy" in low  # explicitly names the word it must NOT use


# --- _converse_text timeout retry + PipelineError --------------------------

class _AlwaysTimesOut:
    """A stand-in bedrock-runtime client whose converse() always raises the
    configured timeout error, counting how many attempts were made."""
    def __init__(self, exc):
        self._exc = exc
        self.calls = 0

    def converse(self, **kwargs):
        self.calls += 1
        raise self._exc


@pytest.mark.parametrize("exc", [
    ReadTimeoutError(endpoint_url="https://bedrock-runtime.eu-west-2.amazonaws.com"),
    ConnectTimeoutError(endpoint_url="https://bedrock-runtime.eu-west-2.amazonaws.com"),
])
def test_converse_text_retries_timeout_then_raises_pipeline_error(monkeypatch, exc):
    fake = _AlwaysTimesOut(exc)
    monkeypatch.setattr(bedrock_text_client, "_client", None)
    monkeypatch.setattr(bedrock_text_client, "_get_client", lambda: fake)
    # don't actually sleep through the backoff
    monkeypatch.setattr(bedrock_text_client.time, "sleep", lambda s: None)

    with pytest.raises(PipelineError) as err:
        bedrock_text_client._converse_text(bedrock_text_client.INSPECTOR_MODEL, "solve this")

    msg = str(err.value)
    assert bedrock_text_client.INSPECTOR_MODEL in msg
    assert "timed out" in msg.lower()
    # retried up to MAX_RETRIES total attempts before giving up
    assert fake.calls == bedrock_text_client.MAX_RETRIES


def test_per_call_timeout_has_reasoning_headroom():
    # the dry run showed a simple question taking ~51s; 60s was too tight.
    assert bedrock_text_client.PER_CALL_TIMEOUT_S == 180


# --- reasoning max_tokens (long chain-of-thought headroom) -----------------

def test_reasoning_max_tokens_is_3000():
    # deepseek/qwen emit long chain-of-thought; 1200 truncated hard questions.
    assert bedrock_text_client.REASONING_MAX_TOKENS == 3000


def _capture_max_tokens(monkeypatch):
    """Monkeypatch _converse_text to capture the max_tokens kwarg and return a
    parseable JSON stub. Returns a dict that fills in with the captured value."""
    captured = {}

    def fake(model_id, prompt, max_tokens=bedrock_text_client.MAX_TOKENS):
        captured["model_id"] = model_id
        captured["max_tokens"] = max_tokens
        return '{"answer": "12", "steps": "s", "difficulty": 3, ' \
               '"exactlyOneCorrect": true, "correctAnswer": "12", ' \
               '"unresolved": false, "rationale": "r"}'

    monkeypatch.setattr(bedrock_text_client, "_converse_text", fake)
    return captured


def test_cold_solve_passes_reasoning_max_tokens(monkeypatch):
    captured = _capture_max_tokens(monkeypatch)
    bedrock_text_client.cold_solve("What is 6+6?", ["10", "11", "12", "13", "14"])
    assert captured["max_tokens"] == 3000
    assert captured["model_id"] == bedrock_text_client.INSPECTOR_MODEL


def test_adjudicate_passes_reasoning_max_tokens(monkeypatch):
    captured = _capture_max_tokens(monkeypatch)
    bedrock_text_client.adjudicate(
        "What is 6+6?", ["10", "11", "12", "13", "14"], 2, "12"
    )
    assert captured["max_tokens"] == 3000
    assert captured["model_id"] == bedrock_text_client.ADJUDICATOR_MODEL
