"""
build_m6_review.py — stage 8 of the synthetic (m6) pipeline (pure join).

Assemble the review bundle the m6 review app loads, keyed by qid, joining the
three per-qid artifacts produced upstream:

  - synthetic/generated/<qid>.json    (stage 2 — Generated_Question)
  - synthetic/inspected/<qid>.json    (stages 3-4 — Inspector_Result + match)
  - synthetic/adjudicated/<qid>.json  (stage 5 — Adjudicator_Verdict, optional)

Two pure helpers run here as part of the join:
  * synthetic_dedup.find_duplicates over the WHOLE batch (within-seed + batch
    scope, never the handoff bank) to surface near-duplicate flags; and
  * synthetic_triage.derive_triage to compute the green/flagged verdict IN OUR
    CODE from artifact fields (no model can mark its own work approved).

Unlike the description bundle (which firewalls the reviewer by OMITTING the
answer), the m6 bundle INCLUDES `correctIndex` and the Generator_Solution: the
human reviewer is the answer authority here and needs the full picture. Each
entry carries all three models' evidence, the triage verdict + reasons, the
stem/options/topic/difficulty, the dedup hits, and a pre-seeded `decision`
(`approve` for green, `null` for flagged).

Writes only under data/synthetic/. Re-runnable and idempotent.

Output: data/synthetic/review-bundle.json

Usage:  data/.venv/bin/python data/pipeline/build_m6_review.py

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 12. build_m6_review.py" and "Data Models -> Review bundle entry".
Requirements: 8.1, 8.2.
"""

from __future__ import annotations

import sys

import synthetic_dedup
import synthetic_triage
from common import DATA_DIR, PipelineError, read_json, write_json

SYNTHETIC_DIR = DATA_DIR / "synthetic"
GENERATED_DIR = SYNTHETIC_DIR / "generated"
INSPECTED_DIR = SYNTHETIC_DIR / "inspected"
ADJUDICATED_DIR = SYNTHETIC_DIR / "adjudicated"


def _coerce_difficulties(gen_difficulty, insp_difficulty):
    """Return a (gen, insp) pair of ints safe for the triage difficulty gap.

    A failed/partial artifact may lack a difficulty, or a model may emit a
    non-int (e.g. the word "easy") that slipped through upstream coercion.
    Rather than crash the pure join on `abs(gen - insp)`, fall back so the gap
    reads as 0 — `had_failure` already forces the flag, so the difficulty term
    must not also blow up or double-count.
    """
    def _as_int(value):
        # bool is an int subclass but is never a valid difficulty.
        if isinstance(value, bool):
            return None
        return value if isinstance(value, int) else None

    gen = _as_int(gen_difficulty)
    insp = _as_int(insp_difficulty)

    if gen is None and insp is None:
        return 1, 1
    if gen is None:
        return insp, insp
    if insp is None:
        return gen, gen
    return gen, insp


def _inspector_view(inspected: dict | None) -> dict | None:
    """Project the inspected artifact down to the evidence the reviewer needs.

    Returns None when the qid was never inspected (a failure the triage step
    already flags via `had_failure`).
    """
    if inspected is None:
        return None
    return {
        "answer": inspected.get("answer"),
        "steps": inspected.get("steps"),
        "inspectorDifficulty": inspected.get("inspectorDifficulty"),
        "exactlyOneCorrect": inspected.get("exactlyOneCorrect"),
        "inspectorIndex": inspected.get("inspectorIndex"),
        "answersAgree": inspected.get("answersAgree"),
    }


def build_bundle() -> dict:
    """Join generated/inspected/adjudicated by qid, run dedup + triage, and
    write synthetic/review-bundle.json. Pure (no network); idempotent."""
    if not GENERATED_DIR.is_dir():
        raise PipelineError(
            "no generated questions found; run generate_questions.py first"
        )

    # 1. Load every per-qid artifact set, keyed by the generated qid.
    loaded: dict[str, dict] = {}
    for gen_path in sorted(GENERATED_DIR.glob("*.json")):
        qid = gen_path.stem
        generated = read_json(gen_path)

        insp_path = INSPECTED_DIR / f"{qid}.json"
        inspected = read_json(insp_path) if insp_path.is_file() else None

        adj_path = ADJUDICATED_DIR / f"{qid}.json"
        adjudicated = read_json(adj_path) if adj_path.is_file() else None

        loaded[qid] = {
            "generated": generated,
            "inspected": inspected,
            "adjudicated": adjudicated,
        }

    # 2. Dedup across the WHOLE batch (within-seed + batch; never handoff bank).
    batch = {qid: {"text": arts["generated"].get("text", "")}
             for qid, arts in loaded.items()}
    seed_of = {qid: arts["generated"].get("seedQid")
               for qid, arts in loaded.items()}
    dup_map = synthetic_dedup.find_duplicates(batch, seed_of)

    # 3. Build one entry per qid: triage in our code, then assemble evidence.
    entries = []
    for qid in sorted(loaded):
        arts = loaded[qid]
        generated = arts["generated"]
        inspected = arts["inspected"]
        adjudicated = arts["adjudicated"]

        gen_failed = generated.get("status") == "failed"
        insp_failed = inspected is not None and inspected.get("status") == "failed"
        adj_failed = adjudicated is not None and adjudicated.get("status") == "failed"
        had_failure = gen_failed or inspected is None or insp_failed or adj_failed

        inspected_ok = inspected is not None and not insp_failed
        answers_agree = bool(inspected.get("answersAgree")) if inspected_ok else False
        exactly_one_correct = (
            bool(inspected.get("exactlyOneCorrect")) if inspected_ok else False
        )

        gen_difficulty, insp_difficulty = _coerce_difficulties(
            generated.get("difficulty"),
            inspected.get("inspectorDifficulty") if inspected is not None else None,
        )

        is_duplicate = qid in dup_map

        verdict, reasons = synthetic_triage.derive_triage(
            answers_agree=answers_agree,
            exactly_one_correct=exactly_one_correct,
            gen_difficulty=gen_difficulty,
            insp_difficulty=insp_difficulty,
            is_duplicate=is_duplicate,
            had_failure=had_failure,
        )

        entries.append({
            "qid": qid,
            "seedQid": generated.get("seedQid"),
            "topic": generated.get("topic"),
            "difficulty": generated.get("difficulty"),
            "stem": generated.get("text", ""),
            "options": list(generated.get("options", [])),
            "correctIndex": generated.get("correctIndex"),
            "generatorSolution": generated.get("generatorSolution"),
            "inspector": _inspector_view(inspected),
            "adjudicator": adjudicated,
            "triage": {"verdict": verdict, "reasons": reasons},
            "duplicates": dup_map.get(qid, []),
            "decision": "approve" if verdict == "green" else None,
        })

    bundle = {"count": len(entries), "entries": entries}
    write_json(SYNTHETIC_DIR / "review-bundle.json", bundle)
    return bundle


def main(argv: list[str]) -> int:
    try:
        bundle = build_bundle()
    except PipelineError as e:
        print(f"[build_m6_review] {e}", file=sys.stderr)
        return 1
    green = sum(1 for e in bundle["entries"] if e["triage"]["verdict"] == "green")
    flagged = bundle["count"] - green
    print(f"[build_m6_review] {bundle['count']} entries "
          f"({green} green, {flagged} flagged) -> synthetic/review-bundle.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
