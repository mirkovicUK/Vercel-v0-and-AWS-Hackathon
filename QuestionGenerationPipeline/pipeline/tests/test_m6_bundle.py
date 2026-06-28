"""Unit tests: the m6 review bundle is a faithful pure join (task 4.7).

Covers Requirements 8.1 (the bundle carries all three models' evidence + flag
reason) and 8.2 (green entries are pre-seeded `approve`, flagged are `null`).

Asserts on tiny fixture artifacts written under pytest's tmp_path:
  * a green entry gets decision == "approve" and the full design entry shape,
  * a flagged (answer-mismatch) entry gets decision == null and keeps its
    adjudicator evidence,
  * a near-duplicate pair surfaces a "duplicate" triage reason and is retained
    (never dropped), with decision == null.
"""

import json
from pathlib import Path

import build_m6_review as bmr

# The exact key set every exported entry must carry (design "Review bundle
# entry" data model).
_ENTRY_KEYS = {
    "qid", "seedQid", "topic", "difficulty", "stem", "options", "correctIndex",
    "generatorSolution", "inspector", "adjudicator", "triage", "duplicates",
    "decision",
}
_INSPECTOR_KEYS = {
    "answer", "steps", "inspectorDifficulty", "exactlyOneCorrect",
    "inspectorIndex", "answersAgree",
}


def _plain_write_json(p, obj):
    """Non-guarded JSON writer so the bundle can be written under tmp_path
    (outside data/, which assert_within_data would otherwise reject)."""
    path = Path(p)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _write(d: Path, qid: str, obj: dict):
    (d / f"{qid}.json").write_text(json.dumps(obj), encoding="utf-8")


def _setup(tmp_path, monkeypatch):
    """Point the module dir constants at a temp synthetic tree and seed tiny
    generated/inspected/adjudicated artifacts covering green, flagged-mismatch,
    and a near-duplicate pair."""
    synthetic = tmp_path / "synthetic"
    generated = synthetic / "generated"
    inspected = synthetic / "inspected"
    adjudicated = synthetic / "adjudicated"
    for sub in (generated, inspected, adjudicated):
        sub.mkdir(parents=True)

    # --- q-m6-001: GREEN (agree, unambiguous, difficulties close, no dup) ---
    _write(generated, "q-m6-001", {
        "qid": "q-m6-001", "seedQid": "q-m1-001", "topic": "number",
        "difficulty": 2, "text": "What is two add two?",
        "options": ["1", "2", "3", "4", "5"], "correctIndex": 3,
        "generatorSolution": "2 + 2 = 4, option D.", "status": "ok",
    })
    _write(inspected, "q-m6-001", {
        "qid": "q-m6-001", "answer": "4", "steps": "add them",
        "inspectorDifficulty": 2, "exactlyOneCorrect": True,
        "inspectorIndex": 3, "answersAgree": True, "status": "ok",
    })

    # --- q-m6-002: FLAGGED (answer mismatch) with an adjudicator verdict ---
    _write(generated, "q-m6-002", {
        "qid": "q-m6-002", "seedQid": "q-m1-002", "topic": "geometry",
        "difficulty": 3,
        "text": "Find the area of a triangle with base six and height four.",
        "options": ["10", "12", "14", "16", "24"], "correctIndex": 1,
        "generatorSolution": "0.5*6*4 = 12, option B.", "status": "ok",
    })
    _write(inspected, "q-m6-002", {
        "qid": "q-m6-002", "answer": "14", "steps": "miscalc",
        "inspectorDifficulty": 3, "exactlyOneCorrect": True,
        "inspectorIndex": 2, "answersAgree": False, "status": "ok",
    })
    _write(adjudicated, "q-m6-002", {
        "qid": "q-m6-002", "trigger": "answer_mismatch", "correctAnswer": "B",
        "unresolved": False, "exactlyOneCorrect": True,
        "rationale": "Generator is right.", "status": "ok",
    })

    # --- q-m6-003 / q-m6-004: near-duplicate pair (otherwise green) ---
    dup_stem = "A train travels at a constant speed for two hours covering distance."
    for qid, seed in (("q-m6-003", "q-m1-003"), ("q-m6-004", "q-m1-003")):
        _write(generated, qid, {
            "qid": qid, "seedQid": seed, "topic": "number", "difficulty": 1,
            "text": dup_stem, "options": ["1", "2", "3", "4", "5"],
            "correctIndex": 0, "generatorSolution": "sol", "status": "ok",
        })
        _write(inspected, qid, {
            "qid": qid, "answer": "1", "steps": "s", "inspectorDifficulty": 1,
            "exactlyOneCorrect": True, "inspectorIndex": 0,
            "answersAgree": True, "status": "ok",
        })

    monkeypatch.setattr(bmr, "SYNTHETIC_DIR", synthetic)
    monkeypatch.setattr(bmr, "GENERATED_DIR", generated)
    monkeypatch.setattr(bmr, "INSPECTED_DIR", inspected)
    monkeypatch.setattr(bmr, "ADJUDICATED_DIR", adjudicated)
    monkeypatch.setattr(bmr, "write_json", _plain_write_json)
    return synthetic


def test_bundle_shape_and_decisions(tmp_path, monkeypatch):
    synthetic = _setup(tmp_path, monkeypatch)
    bundle = bmr.build_bundle()

    assert bundle["count"] == 4
    by_qid = {e["qid"]: e for e in bundle["entries"]}

    # Every entry carries exactly the design entry key set.
    for entry in bundle["entries"]:
        assert set(entry) == _ENTRY_KEYS

    # --- green entry: decision pre-seeded "approve", full evidence present ---
    green = by_qid["q-m6-001"]
    assert green["triage"]["verdict"] == "green"
    assert green["triage"]["reasons"] == []
    assert green["decision"] == "approve"
    assert green["correctIndex"] == 3
    assert green["generatorSolution"] == "2 + 2 = 4, option D."
    assert set(green["inspector"]) == _INSPECTOR_KEYS
    assert green["inspector"]["answersAgree"] is True
    assert green["adjudicator"] is None
    assert green["duplicates"] == []

    # --- flagged (mismatch) entry: decision null, adjudicator retained ---
    flagged = by_qid["q-m6-002"]
    assert flagged["triage"]["verdict"] == "flagged"
    assert "answer_mismatch" in flagged["triage"]["reasons"]
    assert flagged["decision"] is None
    assert flagged["adjudicator"]["correctAnswer"] == "B"


def test_near_duplicates_surface_a_duplicate_reason(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    bundle = bmr.build_bundle()
    by_qid = {e["qid"]: e for e in bundle["entries"]}

    for qid, other in (("q-m6-003", "q-m6-004"), ("q-m6-004", "q-m6-003")):
        entry = by_qid[qid]
        # duplicate is the ONLY thing wrong with this otherwise-green item
        assert entry["triage"]["verdict"] == "flagged"
        assert "duplicate" in entry["triage"]["reasons"]
        # retained, never dropped or auto-rejected
        assert entry["decision"] is None
        assert other in entry["duplicates"]


def test_bundle_written_to_disk(tmp_path, monkeypatch):
    synthetic = _setup(tmp_path, monkeypatch)
    bmr.build_bundle()
    written = json.loads((synthetic / "review-bundle.json").read_text(encoding="utf-8"))
    assert written["count"] == 4
    assert {e["qid"] for e in written["entries"]} == {
        "q-m6-001", "q-m6-002", "q-m6-003", "q-m6-004",
    }


def test_coerce_difficulties_is_robust_to_non_ints():
    """Defense in depth: a non-int difficulty (e.g. the word "easy" that slipped
    through upstream) must never reach `abs(gen - insp)`. The gap reads 0 — the
    failure is already flagged via had_failure."""
    # both valid ints pass through unchanged
    assert bmr._coerce_difficulties(2, 4) == (2, 4)
    # a non-int on either side collapses the gap to 0 (equal pair)
    g, i = bmr._coerce_difficulties("easy", 4)
    assert g == i and abs(g - i) == 0
    g, i = bmr._coerce_difficulties(3, "hard")
    assert g == i and abs(g - i) == 0
    # both non-int / missing -> safe default, gap 0
    g, i = bmr._coerce_difficulties("easy", None)
    assert g == i
    g, i = bmr._coerce_difficulties(None, None)
    assert (g, i) == (1, 1)
    # bool is never a valid difficulty
    g, i = bmr._coerce_difficulties(True, 3)
    assert g == i and abs(g - i) == 0
