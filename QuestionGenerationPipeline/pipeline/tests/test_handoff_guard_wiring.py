"""
Unit tests for the diff-guard wiring inside build_handoff (Req 2.6, 2.7, 2.8).

These exercise the real build_handoff() flow against a TEMP handoff/review tree
(via monkeypatched module dirs) so the real deliverable is never touched. They
confirm:
  - a build that drops an approved question aborts with PipelineError and does
    NOT overwrite handoff/questions.json (Req 2.6, 2.8);
  - the same build proceeds and overwrites when allow_deletions=True (Req 2.7).

Run: data/.venv/bin/python -m pytest data/pipeline/tests/test_handoff_guard_wiring.py
"""

import json

import pytest

import build_handoff as bh
from common import PipelineError


def _approve_entry(qid):
    return {
        "decision": "approve",
        "stem": f"What is the answer to {qid}?",
        "options": ["3", "4", "5", "6", "7"],
        "correctIndex": 1,
        "topic": "number",
        "difficulty": 2,
    }


def _setup_tree(tmp_path, monkeypatch, decision_qids, existing_qids):
    """Build a temp data tree with a review decisions file and an existing
    handoff, and point build_handoff's module dirs at it."""
    handoff = tmp_path / "handoff"
    review = tmp_path / "review"
    work = tmp_path / "work"
    handoff.mkdir()
    review.mkdir()
    work.mkdir()

    # decisions file for tag m1 with the requested approved qids
    decisions = {qid: _approve_entry(qid) for qid in decision_qids}
    (review / "m1-decisions.json").write_text(json.dumps(decisions), encoding="utf-8")

    # existing handoff carrying existing_qids (valid schema)
    existing = [
        {
            "id": qid,
            "text": f"What is the answer to {qid}?",
            "options": ["3", "4", "5", "6", "7"],
            "correctIndex": 1,
            "topic": "number",
            "difficulty": 2,
        }
        for qid in existing_qids
    ]
    (handoff / "questions.json").write_text(json.dumps(existing), encoding="utf-8")

    # assert_within_data confines writes under DATA_DIR; point it at tmp tree.
    monkeypatch.setattr(bh, "HANDOFF_DIR", handoff)
    monkeypatch.setattr(bh, "REVIEW_DIR", review)
    monkeypatch.setattr(bh, "WORK_DIR", work)
    # build_handoff iterates the registry slugs; drive it with a single-slug
    # registry so it reads only the temp m1-decisions.json above.
    monkeypatch.setattr(bh, "load_sources", lambda: {"m1": object()})
    # Stub the backup precondition so NO real durable-tree backup runs against
    # the live bucket (Req 5.1). Tests that need to assert backup behaviour
    # override this with their own spy/raising stub.
    monkeypatch.setattr(bh, "ensure_backup_or_abort", lambda: None)
    # widen the data guard to the temp tree so write_json/assert_within_data pass
    import common
    monkeypatch.setattr(common, "DATA_DIR", tmp_path)

    return handoff / "questions.json"


def test_dropping_a_question_aborts_without_overwrite(tmp_path, monkeypatch):
    # existing has 2 approved; prospective build only re-derives 1 -> disappeared + count_drop
    qpath = _setup_tree(
        tmp_path, monkeypatch,
        decision_qids=["q-m1-001"],
        existing_qids=["q-m1-001", "q-m1-002"],
    )
    before = qpath.read_text(encoding="utf-8")

    with pytest.raises(PipelineError) as ei:
        bh.build_handoff()
    assert "allow-deletions" in str(ei.value)

    # Req 2.8: no overwrite happened.
    assert qpath.read_text(encoding="utf-8") == before


def test_allow_deletions_permits_overwrite(tmp_path, monkeypatch):
    qpath = _setup_tree(
        tmp_path, monkeypatch,
        decision_qids=["q-m1-001"],
        existing_qids=["q-m1-001", "q-m1-002"],
    )

    res = bh.build_handoff(allow_deletions=True)

    # Req 2.7: the overwrite proceeded with the reduced set.
    assert res["written"] == 1
    written = json.loads(qpath.read_text(encoding="utf-8"))
    assert [q["id"] for q in written] == ["q-m1-001"]


def test_clean_build_overwrites_normally(tmp_path, monkeypatch):
    # prospective preserves every existing id -> no violations
    qpath = _setup_tree(
        tmp_path, monkeypatch,
        decision_qids=["q-m1-001", "q-m1-002"],
        existing_qids=["q-m1-001", "q-m1-002"],
    )

    res = bh.build_handoff()
    assert res["written"] == 2
    written = json.loads(qpath.read_text(encoding="utf-8"))
    assert [q["id"] for q in written] == ["q-m1-001", "q-m1-002"]


# ---------------------------------------------------------------------------
# Backup-precondition wiring (Req 5.1, 5.2) — task 7.3
#
# These confirm build_handoff runs ensure_backup_or_abort() BEFORE any overwrite
# of handoff/questions.json, and that a failed backup aborts the build without
# overwriting. ensure_backup_or_abort is always stubbed so NO real backup runs.
# ---------------------------------------------------------------------------

def test_backup_runs_before_write_json(tmp_path, monkeypatch):
    # clean build (no diff-guard violations) so the only gate is the backup.
    qpath = _setup_tree(
        tmp_path, monkeypatch,
        decision_qids=["q-m1-001", "q-m1-002"],
        existing_qids=["q-m1-001", "q-m1-002"],
    )

    order: list[str] = []

    # Spy stub: record that the backup ran, and capture the handoff bytes at the
    # moment of the call so we can prove no overwrite has happened yet.
    handoff_at_backup_time: dict[str, str] = {}

    def backup_spy():
        order.append("backup")
        handoff_at_backup_time["bytes"] = qpath.read_text(encoding="utf-8")

    real_write_json = bh.write_json

    def write_json_spy(path, data):
        order.append("write_json")
        return real_write_json(path, data)

    monkeypatch.setattr(bh, "ensure_backup_or_abort", backup_spy)
    monkeypatch.setattr(bh, "write_json", write_json_spy)

    before = qpath.read_text(encoding="utf-8")
    bh.build_handoff()

    # Req 5.1: the backup is invoked, and it runs before the handoff write.
    assert order[0] == "backup"
    assert "write_json" in order
    assert order.index("backup") < order.index("write_json")
    # At backup time the existing handoff was still untouched.
    assert handoff_at_backup_time["bytes"] == before


def test_failed_backup_aborts_without_overwrite(tmp_path, monkeypatch):
    # A clean build (no diff-guard violations) so the abort is solely the backup
    # precondition failing (Req 5.2).
    qpath = _setup_tree(
        tmp_path, monkeypatch,
        decision_qids=["q-m1-001", "q-m1-002"],
        existing_qids=["q-m1-001", "q-m1-002"],
    )
    before = qpath.read_text(encoding="utf-8")

    def failing_backup():
        raise PipelineError("backup precondition failed: refusing to proceed")

    # If the backup fails, write_json must never run.
    def write_json_must_not_run(path, data):
        raise AssertionError("write_json was called despite a failed backup")

    monkeypatch.setattr(bh, "ensure_backup_or_abort", failing_backup)
    monkeypatch.setattr(bh, "write_json", write_json_must_not_run)

    with pytest.raises(PipelineError) as ei:
        bh.build_handoff()
    assert "backup precondition failed" in str(ei.value)

    # Req 5.2: nothing was overwritten.
    assert qpath.read_text(encoding="utf-8") == before


def test_check_only_does_not_trigger_backup(tmp_path, monkeypatch):
    # The --check path re-validates the existing handoff and must NOT back up
    # (it overwrites nothing).
    handoff = tmp_path / "handoff"
    handoff.mkdir()
    existing = [
        {
            "id": "q-m1-001",
            "text": "What is the answer to q-m1-001?",
            "options": ["3", "4", "5", "6", "7"],
            "correctIndex": 1,
            "topic": "number",
            "difficulty": 2,
        }
    ]
    (handoff / "questions.json").write_text(json.dumps(existing), encoding="utf-8")
    monkeypatch.setattr(bh, "HANDOFF_DIR", handoff)

    def backup_must_not_run():
        raise AssertionError("check_only must not trigger a backup")

    monkeypatch.setattr(bh, "ensure_backup_or_abort", backup_must_not_run)

    res = bh.check_only()
    assert res["count"] == 1
