"""
Unit tests for generate_questions.py (stage 2 of the synthetic m6 pipeline).

These tests MOCK the Bedrock Generator (bedrock_text_client.generate) — no real
network calls — and point the stage's output dir at pytest's tmp_path via a
non-guarded write_json, mirroring test_description_bundle.py.

They assert:
  - each seed yields exactly five artifacts at difficulties 1..5 (Req 2.1);
  - a re-run skips slots whose artifact already exists (resumability, one call
    per slot — Req 2.5, 11.6);
  - a failed generate() persists a status="failed" artifact (never dropped —
    Req 2.2/2.3 via triage flagging).

Run: data/.venv/bin/python -m pytest data/pipeline/tests/test_generate_questions.py -q
"""

import json
from pathlib import Path

import generate_questions as gq
import seed_selector
from seed_selector import Seed


def _plain_write_json(p, obj):
    """A non-guarded JSON writer so tests can write under pytest's tmp_path
    (outside data/, which assert_within_data would otherwise reject)."""
    path = Path(p)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


FAKE_SEEDS = [
    Seed(qid="q-m1-001", ordinal=1, topic="number", text="What is 2 + 2?"),
    Seed(qid="q-m1-002", ordinal=2, topic="algebra", text="Solve x + 1 = 3."),
]


def _ok_generate(seed_text, seed_topic, difficulty):
    return {
        "text": f"{seed_topic} question d{difficulty}",
        "options": ["a", "b", "c", "d", "e"],
        "correctIndex": difficulty % 5,
        "generatorSolution": "Step 1 ... therefore.",
        "model": "eu.anthropic.claude-opus-4-6-v1",
        "promptVersion": "m6-generate-v1",
        "status": "ok",
    }


def _setup(tmp_path, monkeypatch, generate_fn=_ok_generate, seeds=FAKE_SEEDS):
    """Point the stage's output dir at a temp tree, stub select_seeds with a
    tiny fake seed set, and mock the Bedrock Generator."""
    generated = tmp_path / "synthetic" / "generated"

    monkeypatch.setattr(gq, "GENERATED_DIR", generated)
    monkeypatch.setattr(gq, "write_json", _plain_write_json)
    monkeypatch.setattr(gq, "assert_within_data", lambda p: Path(p))
    monkeypatch.setattr(seed_selector, "select_seeds",
                        lambda only=None, limit=None: list(seeds))
    monkeypatch.setattr(gq.bedrock_text_client, "generate", generate_fn)

    return generated


def test_each_seed_yields_five_artifacts_difficulties_1_to_5(tmp_path, monkeypatch):
    generated = _setup(tmp_path, monkeypatch)

    res = gq.generate_all()

    assert res["selected_slots"] == 10  # 2 seeds * 5 difficulties
    assert res["generated"] == 10
    assert res["skipped"] == 0
    assert res["failed"] == 0

    # Exactly 5 artifacts per seed, one per difficulty 1..5.
    for seed in FAKE_SEEDS:
        diffs = []
        for difficulty in (1, 2, 3, 4, 5):
            qid = gq.synthetic_qid(seed.ordinal, difficulty)
            art = json.loads((generated / f"{qid}.json").read_text(encoding="utf-8"))
            assert art["seedQid"] == seed.qid
            assert art["topic"] == seed.topic   # topic inherited from the seed
            assert art["difficulty"] == difficulty
            assert art["status"] == "ok"
            assert len(art["options"]) == 5
            assert "createdAt" in art
            diffs.append(art["difficulty"])
        assert sorted(diffs) == [1, 2, 3, 4, 5]

    # 10 files total, no extras.
    assert len(list(generated.glob("*.json"))) == 10


def test_rerun_skips_existing_artifacts(tmp_path, monkeypatch):
    generated = _setup(tmp_path, monkeypatch)

    first = gq.generate_all()
    assert first["generated"] == 10

    # Count Generator calls on the second run — every slot must be skipped.
    calls = {"n": 0}

    def counting_generate(seed_text, seed_topic, difficulty):
        calls["n"] += 1
        return _ok_generate(seed_text, seed_topic, difficulty)

    monkeypatch.setattr(gq.bedrock_text_client, "generate", counting_generate)

    second = gq.generate_all()
    assert second["generated"] == 0
    assert second["skipped"] == 10
    assert calls["n"] == 0  # one-call-per-slot: no regeneration


def test_failed_generate_persists_failed_artifact(tmp_path, monkeypatch):
    def failed_generate(seed_text, seed_topic, difficulty):
        return {
            "status": "failed",
            "raw": "not json at all",
            "model": "eu.anthropic.claude-opus-4-6-v1",
            "promptVersion": "m6-generate-v1",
        }

    generated = _setup(tmp_path, monkeypatch, generate_fn=failed_generate,
                       seeds=[FAKE_SEEDS[0]])

    res = gq.generate_all()

    assert res["selected_slots"] == 5
    assert res["generated"] == 0
    assert res["failed"] == 5

    # Every artifact persisted with status="failed" and the raw text, not dropped.
    for difficulty in (1, 2, 3, 4, 5):
        qid = gq.synthetic_qid(1, difficulty)
        art = json.loads((generated / f"{qid}.json").read_text(encoding="utf-8"))
        assert art["status"] == "failed"
        assert art["raw"] == "not json at all"
        assert art["seedQid"] == "q-m1-001"
        assert art["difficulty"] == difficulty
        assert "options" not in art
    assert len(list(generated.glob("*.json"))) == 5
