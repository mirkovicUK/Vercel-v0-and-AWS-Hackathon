"""
generate_questions.py — stage 2 of the synthetic (m6) pipeline.

For each Seed selected by `seed_selector.select_seeds` and each difficulty in
`synthetic_ids.DIFFICULTIES` (1..5), this stage produces exactly one
Generated_Question and writes it to `data/synthetic/generated/<qid>.json`.

The per-qid artifact is the idempotency key: a slot is generated EXACTLY ONCE.
If `synthetic/generated/<qid>.json` already exists, the slot is SKIPPED — the
script never deletes or auto-regenerates a slot, so a run is fully resumable
and makes at most one Generator (Bedrock) call per slot (Req 2.5, 11.6).

On a parse failure the Generator returns `status="failed"` with the raw model
text; the artifact is STILL written (with `status="failed"`), never silently
dropped, so the triage stage can flag it (Req 2.2 reliability via flagging).

`--only` / `--limit` flow straight through `seed_selector` to scope a
Calibration_Subset run.

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 6. generate_questions.py" and the Generated_Question data model.

Requirements: 2.1, 2.2, 2.3, 2.5, 11.6.

Usage:
  data/.venv/bin/python data/pipeline/generate_questions.py
  data/.venv/bin/python data/pipeline/generate_questions.py --only q-m1-001,q-m3-014
  data/.venv/bin/python data/pipeline/generate_questions.py --limit 5
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from common import DATA_DIR, PipelineError, assert_within_data, write_json
import bedrock_text_client
import seed_selector
from synthetic_ids import DIFFICULTIES, synthetic_qid

# All stage-2 artifacts live under data/synthetic/generated/<qid>.json.
SYNTHETIC_DIR = DATA_DIR / "synthetic"
GENERATED_DIR = SYNTHETIC_DIR / "generated"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def generate_all(only=None, limit=None) -> dict:
    """Generate one Generated_Question per (selected seed × difficulty 1..5).

    For each slot, qid = synthetic_qid(seed.ordinal, difficulty). If the
    per-qid artifact already exists it is SKIPPED (resumable, one-call-per-slot,
    never auto-regenerated). Otherwise the Generator is called once and the
    Generated_Question artifact is written — including a `status="failed"`
    artifact when the model output could not be parsed (never silently dropped).

    Returns counts: {selected_slots, generated, skipped, failed}.
    """
    out_dir = assert_within_data(GENERATED_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    seeds = seed_selector.select_seeds(only=only, limit=limit)

    selected_slots = len(seeds) * len(DIFFICULTIES)
    generated = skipped = failed = 0

    for seed in seeds:
        for difficulty in DIFFICULTIES:
            qid = synthetic_qid(seed.ordinal, difficulty)
            out_path = out_dir / f"{qid}.json"
            if out_path.is_file():
                skipped += 1
                continue  # resumable: one call per slot, never regenerate (Req 2.5, 11.6)

            result = bedrock_text_client.generate(seed.text, seed.topic, difficulty)

            if result.get("status") == "failed":
                # Persist the failure so triage can flag it — never drop it.
                record = {
                    "qid": qid,
                    "seedQid": seed.qid,
                    "topic": seed.topic,
                    "difficulty": difficulty,
                    "status": "failed",
                    "raw": result.get("raw"),
                    "model": result.get("model"),
                    "promptVersion": result.get("promptVersion"),
                    "createdAt": _now(),
                }
                write_json(out_path, record)
                failed += 1
                print(f"[generate_questions] FAILED {qid} (status=failed, persisted for triage)",
                      file=sys.stderr)
                continue

            record = {
                "qid": qid,
                "seedQid": seed.qid,
                "topic": seed.topic,
                "difficulty": difficulty,
                "text": result.get("text"),
                "options": result.get("options"),
                "correctIndex": result.get("correctIndex"),
                "generatorSolution": result.get("generatorSolution"),
                "model": result.get("model"),
                "promptVersion": result.get("promptVersion"),
                "status": "ok",
                "createdAt": _now(),
            }
            write_json(out_path, record)
            generated += 1
            print(f"[generate_questions] generated {qid} (seed {seed.qid}, difficulty {difficulty})")

    return {"selected_slots": selected_slots, "generated": generated,
            "skipped": skipped, "failed": failed}


def _parse_only(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [s.strip() for s in value.split(",") if s.strip()]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Generate synthetic m6 questions (5 per seed, difficulties 1..5) — stage 2."
    )
    ap.add_argument("--only", help="comma-separated handoff seed qids to keep (calibration subset)")
    ap.add_argument("--limit", type=int, help="generate from at most N seeds")
    args = ap.parse_args(argv[1:])

    try:
        res = generate_all(only=_parse_only(args.only), limit=args.limit)
    except PipelineError as e:
        print(f"[generate_questions] {e}", file=sys.stderr)
        return 1

    print(f"[generate_questions] slots {res['selected_slots']}: "
          f"generated {res['generated']}, skipped {res['skipped']} (already done), "
          f"failed {res['failed']} -> synthetic/generated/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
