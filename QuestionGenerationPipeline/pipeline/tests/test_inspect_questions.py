"""
Verification tests for inspect_questions.py (stage 3, runs stage-4 match inline).

These use a MOCKED cold_solve over tiny fixture Generated_Question artifacts in a
temporary synthetic dir (no real Bedrock calls). They assert:

  - the FIREWALL: cold_solve is called with ONLY the question text + options, and
    the Generator's correctIndex value never appears in its call arguments
    (Req 3.1, 3.2);
  - the inline stage-4 match populates inspectorIndex + answersAgree (Req 4.4);
  - a failed Generated_Question yields a failed inspected artifact with NO model
    call (Req 11.5/11.6);
  - a cold_solve failure yields a failed inspected artifact (Req 11.5);
  - the stage is resumable — an existing inspected artifact is skipped (Req 11.6).

Run: data/.venv/bin/python -m pytest data/pipeline/tests/test_inspect_questions.py -q
"""

from __future__ import annotations

import json

import pytest

import common
import inspect_questions


# Sentinel value used to prove the Generator's correctIndex never reaches the
# Inspector. Distinctive so we can scan call args for it.
SENTINEL_CORRECT_INDEX = 3


@pytest.fixture
def synth_dirs(tmp_path, monkeypatch):
    """Point the pipeline's data root + the stage dirs at a tmp tree so that
    assert_within_data permits writes and nothing touches the real data/."""
    data_root = tmp_path / "data"
    generated = data_root / "synthetic" / "generated"
    inspected = data_root / "synthetic" / "inspected"
    generated.mkdir(parents=True)
    inspected.mkdir(parents=True)

    # assert_within_data resolves against common.DATA_DIR; redirect it so writes
    # under the tmp tree are allowed.
    monkeypatch.setattr(common, "DATA_DIR", data_root)
    monkeypatch.setattr(inspect_questions, "GENERATED_DIR", generated)
    monkeypatch.setattr(inspect_questions, "INSPECTED_DIR", inspected)
    return generated, inspected


def _write_generated(generated_dir, qid, **overrides):
    artifact = {
        "qid": qid,
        "seedQid": "q-m1-001",
        "topic": "number",
        "difficulty": 1,
        "text": "What is 6 + 6?",
        "options": ["10", "11", "12", "13", "14"],
        "correctIndex": SENTINEL_CORRECT_INDEX,
        "generatorSolution": "6 + 6 = 12.",
        "model": "eu.anthropic.claude-opus-4-6-v1",
        "promptVersion": "m6-generate-v1",
        "status": "ok",
        "createdAt": "2025-01-01T00:00:00Z",
    }
    artifact.update(overrides)
    (generated_dir / f"{qid}.json").write_text(
        json.dumps(artifact), encoding="utf-8"
    )
    return artifact


def _read_inspected(inspected_dir, qid):
    return json.loads((inspected_dir / f"{qid}.json").read_text(encoding="utf-8"))


def test_firewall_and_inline_match(synth_dirs, monkeypatch):
    generated_dir, inspected_dir = synth_dirs
    # correctIndex = 3 ("13"); make the Inspector answer "13" too so they agree.
    _write_generated(generated_dir, "q-m6-004", correctIndex=3,
                     text="Pick thirteen.", options=["10", "11", "12", "13", "14"])

    calls = []

    def fake_cold_solve(question_text, options):
        calls.append((question_text, options))
        return {
            "answer": "13",
            "steps": "It is 13.",
            "difficulty": 2,
            "exactlyOneCorrect": True,
            "model": "deepseek.v3.2",
            "promptVersion": "m6-cold-solve-v1",
            "status": "ok",
        }

    monkeypatch.setattr(inspect_questions.bedrock_text_client, "cold_solve", fake_cold_solve)

    res = inspect_questions.inspect_all()

    assert res == {"selected": 1, "inspected": 1, "skipped": 0, "failed": 0}

    # FIREWALL: cold_solve saw exactly (text, options) and never the index.
    assert calls == [("Pick thirteen.", ["10", "11", "12", "13", "14"])]
    flat_args = [calls[0][0], *calls[0][1]]
    assert SENTINEL_CORRECT_INDEX not in flat_args
    assert "correctIndex" not in calls[0][0]

    art = _read_inspected(inspected_dir, "q-m6-004")
    assert art["status"] == "ok"
    assert art["inspectorIndex"] == 3          # "13" -> index 3
    assert art["answersAgree"] is True
    assert art["inspectorDifficulty"] == 2
    assert art["exactlyOneCorrect"] is True
    assert art["answer"] == "13"


def test_inline_match_disagreement(synth_dirs, monkeypatch):
    generated_dir, inspected_dir = synth_dirs
    _write_generated(generated_dir, "q-m6-001", correctIndex=2,
                     options=["10", "11", "12", "13", "14"])

    # Inspector picks "14" (index 4) -> disagrees with correctIndex 2.
    monkeypatch.setattr(
        inspect_questions.bedrock_text_client, "cold_solve",
        lambda t, o: {"answer": "14", "steps": "", "difficulty": 1,
                      "exactlyOneCorrect": True, "model": "deepseek.v3.2",
                      "promptVersion": "m6-cold-solve-v1", "status": "ok"},
    )

    inspect_questions.inspect_all()
    art = _read_inspected(inspected_dir, "q-m6-001")
    assert art["inspectorIndex"] == 4
    assert art["answersAgree"] is False


def test_failed_generated_yields_failed_inspected_without_model_call(synth_dirs, monkeypatch):
    generated_dir, inspected_dir = synth_dirs
    _write_generated(generated_dir, "q-m6-002", status="failed",
                     options=None, text=None, correctIndex=None)

    def boom(*a, **k):
        raise AssertionError("cold_solve must NOT be called for a failed generated artifact")

    monkeypatch.setattr(inspect_questions.bedrock_text_client, "cold_solve", boom)

    res = inspect_questions.inspect_all()
    assert res["failed"] == 1
    art = _read_inspected(inspected_dir, "q-m6-002")
    assert art["status"] == "failed"
    assert art["inspectorIndex"] is None
    assert art["answersAgree"] is False
    assert "reason" in art


def test_cold_solve_failure_yields_failed_inspected(synth_dirs, monkeypatch):
    generated_dir, inspected_dir = synth_dirs
    _write_generated(generated_dir, "q-m6-003")

    monkeypatch.setattr(
        inspect_questions.bedrock_text_client, "cold_solve",
        lambda t, o: {"status": "failed", "raw": "garbage",
                      "model": "deepseek.v3.2", "promptVersion": "m6-cold-solve-v1"},
    )

    res = inspect_questions.inspect_all()
    assert res["failed"] == 1
    art = _read_inspected(inspected_dir, "q-m6-003")
    assert art["status"] == "failed"
    assert art["inspectorIndex"] is None
    assert art["answersAgree"] is False


def test_resumable_skips_existing(synth_dirs, monkeypatch):
    generated_dir, inspected_dir = synth_dirs
    _write_generated(generated_dir, "q-m6-005")
    # Pre-existing inspected artifact -> must be skipped, model not called.
    (inspected_dir / "q-m6-005.json").write_text(
        json.dumps({"qid": "q-m6-005", "status": "ok"}), encoding="utf-8"
    )

    def boom(*a, **k):
        raise AssertionError("cold_solve must NOT be called when artifact exists")

    monkeypatch.setattr(inspect_questions.bedrock_text_client, "cold_solve", boom)

    res = inspect_questions.inspect_all()
    assert res == {"selected": 1, "inspected": 0, "skipped": 1, "failed": 0}


def test_only_and_limit_filter_generated_qids(synth_dirs, monkeypatch):
    generated_dir, inspected_dir = synth_dirs
    for qid in ("q-m6-001", "q-m6-002", "q-m6-003"):
        _write_generated(generated_dir, qid)

    seen = []
    monkeypatch.setattr(
        inspect_questions.bedrock_text_client, "cold_solve",
        lambda t, o: seen.append(1) or {"answer": "12", "steps": "", "difficulty": 1,
                                         "exactlyOneCorrect": True, "model": "deepseek.v3.2",
                                         "promptVersion": "m6-cold-solve-v1", "status": "ok"},
    )

    res = inspect_questions.inspect_all(only=["q-m6-002"])
    assert res["selected"] == 1
    assert (inspected_dir / "q-m6-002.json").is_file()
    assert not (inspected_dir / "q-m6-001.json").is_file()
