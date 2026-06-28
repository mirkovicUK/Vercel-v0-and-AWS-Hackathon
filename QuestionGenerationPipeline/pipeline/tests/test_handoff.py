"""
Unit tests for build_handoff validation + round-trip logic (Properties 4, 5, 6).

Run: data/.venv/bin/python -m pytest data/pipeline/tests/test_handoff.py
"""

import build_handoff as bh


def _valid_question(**over):
    q = {
        "id": "q-m1-001",
        "text": "What is 2 + 2?",
        "options": ["3", "4", "5", "6", "7"],
        "correctIndex": 1,
        "topic": "number",
        "difficulty": 2,
    }
    q.update(over)
    return q


def test_valid_question_passes():
    assert bh.validate_question(_valid_question()) == []


def test_bad_topic_rejected():
    problems = bh.validate_question(_valid_question(topic="trigonometry"))
    assert any("topic" in p for p in problems)


def test_difficulty_out_of_range_rejected():
    assert bh.validate_question(_valid_question(difficulty=6))
    assert bh.validate_question(_valid_question(difficulty=0))
    assert bh.validate_question(_valid_question(difficulty="2"))  # must be int


def test_correct_index_out_of_bounds_rejected():
    assert bh.validate_question(_valid_question(correctIndex=5))   # len(options)==5 -> max idx 4
    assert bh.validate_question(_valid_question(correctIndex=-1))
    assert bh.validate_question(_valid_question(correctIndex=None))


def test_empty_text_rejected():
    assert bh.validate_question(_valid_question(text="  "))


def test_empty_option_rejected():
    assert bh.validate_question(_valid_question(options=["a", "", "c", "d", "e"]))


def test_nonconforming_field_rejected():
    q = _valid_question()
    q["sourcePage"] = 3  # not in the allowed schema fields
    problems = bh.validate_question(q)
    assert any("nonconforming" in p for p in problems)


def test_imageurl_is_allowed_field():
    assert bh.validate_question(_valid_question(imageUrl="figures/q-m1-002.png")) == []


def test_round_trip_detects_missing_and_orphans(tmp_path):
    # one question references a figure that doesn't exist -> missing;
    # one file on disk isn't referenced -> orphan.
    figdir = tmp_path / "figures"
    figdir.mkdir()
    (figdir / "q-m1-009.png").write_bytes(b"\x89PNG\r\n")  # orphan on disk
    questions = [
        _valid_question(id="q-m1-001", imageUrl="figures/q-m1-002.png"),  # missing file
        _valid_question(id="q-m1-003"),                                   # no figure
    ]
    rt = bh.check_round_trip(questions, figdir)
    assert "q-m1-001" in rt["missing"]
    assert "q-m1-009.png" in rt["orphans"]
