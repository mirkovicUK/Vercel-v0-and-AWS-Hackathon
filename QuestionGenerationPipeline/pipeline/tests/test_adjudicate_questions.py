"""
Verification tests for adjudicate_questions.py (stage 5).

The Adjudicator is invoked EXACTLY when the two solvers disagree
(answersAgree not True) OR the item is ambiguous (exactlyOneCorrect not True),
and is skipped — writing NO artifact — when neither trigger holds. We also
verify resumability and the upstream-failure recording path.

Bedrock is MOCKED throughout: NO real network calls are made.

Validates: Requirements 5.1, 5.2, 5.3, 11.6
"""

import json
from pathlib import Path

import pytest

import adjudicate_questions as aq


def _plain_write_json(p, obj):
    """Non-guarded JSON writer so tests can write under pytest's tmp_path
    (outside data/, which assert_within_data would otherwise reject)."""
    path = Path(p)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


@pytest.fixture
def synthetic_tree(tmp_path, monkeypatch):
    """Point the module's directory constants at a temp synthetic tree and
    neutralise the data/ write guard."""
    generated = tmp_path / "generated"
    inspected = tmp_path / "inspected"
    adjudicated = tmp_path / "adjudicated"
    for d in (generated, inspected):
        d.mkdir(parents=True)

    monkeypatch.setattr(aq, "GENERATED_DIR", generated)
    monkeypatch.setattr(aq, "INSPECTED_DIR", inspected)
    monkeypatch.setattr(aq, "ADJUDICATED_DIR", adjudicated)
    monkeypatch.setattr(aq, "write_json", _plain_write_json)
    monkeypatch.setattr(aq, "assert_within_data", lambda p: Path(p))
    return generated, inspected, adjudicated


def _write_generated(generated_dir, qid, *, status="ok"):
    obj = {
        "qid": qid,
        "topic": "number",
        "difficulty": 1,
        "text": f"Stem {qid}",
        "options": ["1", "2", "3", "4", "5"],
        "correctIndex": 2,
        "generatorSolution": "...",
        "model": "gen",
        "promptVersion": "v1",
        "status": status,
    }
    if status == "failed":
        obj = {"qid": qid, "status": "failed", "raw": "garbage"}
    (generated_dir / f"{qid}.json").write_text(json.dumps(obj), encoding="utf-8")


def _write_inspected(inspected_dir, qid, *, answers_agree, exactly_one_correct,
                     status="ok"):
    obj = {
        "qid": qid,
        "answer": "3",
        "steps": "...",
        "inspectorDifficulty": 1,
        "exactlyOneCorrect": exactly_one_correct,
        "inspectorIndex": 2,
        "answersAgree": answers_agree,
        "model": "insp",
        "promptVersion": "v1",
        "status": status,
    }
    (inspected_dir / f"{qid}.json").write_text(json.dumps(obj), encoding="utf-8")


def _mock_adjudicate(monkeypatch):
    """Replace bedrock_text_client.adjudicate with a recording stub and return
    the call log."""
    calls = []

    def fake(question_text, options, gen_answer_index, insp_answer_text):
        calls.append((question_text, options, gen_answer_index, insp_answer_text))
        return {
            "correctAnswer": "C",
            "unresolved": False,
            "exactlyOneCorrect": True,
            "rationale": "because",
            "model": "qwen",
            "promptVersion": "m6-adjudicate-v1",
            "status": "ok",
        }

    monkeypatch.setattr(aq.bedrock_text_client, "adjudicate", fake)
    return calls


def test_invoked_on_disagreement(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-001")
    _write_inspected(inspected, "q-m6-001", answers_agree=False,
                     exactly_one_correct=True)
    calls = _mock_adjudicate(monkeypatch)

    res = aq.adjudicate_all()

    assert len(calls) == 1
    assert res["invoked"] == 1
    assert res["skipped_no_trigger"] == 0
    art = json.loads((adjudicated / "q-m6-001.json").read_text())
    assert art["trigger"] == "answer_mismatch"
    assert art["status"] == "ok"


def test_invoked_on_ambiguity(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-002")
    # answers agree, but inspector says not exactly one correct -> ambiguity
    _write_inspected(inspected, "q-m6-002", answers_agree=True,
                     exactly_one_correct=False)
    calls = _mock_adjudicate(monkeypatch)

    res = aq.adjudicate_all()

    assert len(calls) == 1
    assert res["invoked"] == 1
    art = json.loads((adjudicated / "q-m6-002.json").read_text())
    assert art["trigger"] == "ambiguity"


def test_trigger_records_both_when_disagree_and_ambiguous(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-003")
    _write_inspected(inspected, "q-m6-003", answers_agree=False,
                     exactly_one_correct=False)
    _mock_adjudicate(monkeypatch)

    aq.adjudicate_all()

    art = json.loads((adjudicated / "q-m6-003.json").read_text())
    assert art["trigger"] == "answer_mismatch+ambiguity"


def test_skipped_no_trigger_writes_no_artifact(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-004")
    # agree AND exactly one correct -> no trigger
    _write_inspected(inspected, "q-m6-004", answers_agree=True,
                     exactly_one_correct=True)
    calls = _mock_adjudicate(monkeypatch)

    res = aq.adjudicate_all()

    assert len(calls) == 0
    assert res["invoked"] == 0
    assert res["skipped_no_trigger"] == 1
    # NO artifact written
    assert not (adjudicated / "q-m6-004.json").exists()


def test_resumable_skips_existing(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-005")
    _write_inspected(inspected, "q-m6-005", answers_agree=False,
                     exactly_one_correct=True)
    adjudicated.mkdir(parents=True, exist_ok=True)
    (adjudicated / "q-m6-005.json").write_text(
        json.dumps({"qid": "q-m6-005", "status": "ok", "trigger": "answer_mismatch"}),
        encoding="utf-8")
    calls = _mock_adjudicate(monkeypatch)

    res = aq.adjudicate_all()

    # already-present artifact => no model call
    assert len(calls) == 0
    assert res["skipped_existing"] == 1
    assert res["invoked"] == 0


def test_upstream_failure_records_failed_without_model_call(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-006", status="failed")
    _write_inspected(inspected, "q-m6-006", answers_agree=False,
                     exactly_one_correct=True)
    calls = _mock_adjudicate(monkeypatch)

    res = aq.adjudicate_all()

    assert len(calls) == 0  # model NOT called on upstream failure
    assert res["failed"] == 1
    art = json.loads((adjudicated / "q-m6-006.json").read_text())
    assert art["status"] == "failed"
    assert art["trigger"] == "upstream_failure"


def test_adjudicate_call_arguments(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-007")
    _write_inspected(inspected, "q-m6-007", answers_agree=False,
                     exactly_one_correct=True)
    calls = _mock_adjudicate(monkeypatch)

    aq.adjudicate_all()

    question_text, options, gen_index, insp_answer = calls[0]
    assert question_text == "Stem q-m6-007"
    assert options == ["1", "2", "3", "4", "5"]
    assert gen_index == 2
    assert insp_answer == "3"


def test_parse_failure_persists_failed_verdict(synthetic_tree, monkeypatch):
    generated, inspected, adjudicated = synthetic_tree
    _write_generated(generated, "q-m6-008")
    _write_inspected(inspected, "q-m6-008", answers_agree=False,
                     exactly_one_correct=True)

    def fake(*a, **k):
        return {"status": "failed", "raw": "junk", "model": "qwen",
                "promptVersion": "m6-adjudicate-v1"}
    monkeypatch.setattr(aq.bedrock_text_client, "adjudicate", fake)

    res = aq.adjudicate_all()

    assert res["failed"] == 1
    art = json.loads((adjudicated / "q-m6-008.json").read_text())
    assert art["status"] == "failed"
    assert art["trigger"] == "answer_mismatch"
    assert art["raw"] == "junk"
