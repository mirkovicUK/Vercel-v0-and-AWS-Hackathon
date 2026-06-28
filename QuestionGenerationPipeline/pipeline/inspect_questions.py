"""
inspect_questions.py — stage 3 of the synthetic (m6) pipeline (runs stage 4
inline).

For each Generated_Question in ``data/synthetic/generated/<qid>.json`` that does
not yet have an inspected artifact, this stage asks the Inspector model
(DeepSeek, a different family from the Generator) to solve the question COLD —
from the question text and the five options ONLY. The Inspector NEVER receives
the Generator's flagged ``correctIndex``: ``cold_solve`` has no parameter for it
(the firewall is enforced by the type, not by discipline) (Req 3.1, 3.2).

The deterministic answer match (stage 4) runs inline here because it is pure and
cheap: the Inspector's free-text answer is mapped to an option index with
``synthetic_match.match_inspector_answer`` (the answer_match tiers), and
``synthetic_match.answers_agree`` records whether that resolved index equals the
Generator's flagged index (Req 4.4). The written Inspector_Result therefore
already carries ``inspectorIndex`` and ``answersAgree``.

Failure handling (Req 11.5/11.6):
  - a Generated_Question already marked ``status="failed"`` (the Generator could
    not produce usable options) yields a ``status="failed"`` inspected artifact
    carrying the reason, and NO model call is made;
  - a Converse/parse failure from ``cold_solve`` yields a ``status="failed"``
    inspected artifact so triage flags the qid.

Resumable (Req 11.6): an existing ``synthetic/inspected/<qid>.json`` is skipped.
Same ``--only`` / ``--limit`` calibration selection as the other stages, applied
to the generated qids.

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 7. inspect_questions.py" and the Inspector_Result + match record
Data Model. Requirements: 3.1, 3.2, 3.3, 4.4, 11.6.

Usage:
  data/.venv/bin/python data/pipeline/inspect_questions.py
  data/.venv/bin/python data/pipeline/inspect_questions.py --only q-m6-001
  data/.venv/bin/python data/pipeline/inspect_questions.py --limit 5
"""

from __future__ import annotations

import argparse
import sys

from common import (
    DATA_DIR,
    PipelineError,
    assert_within_data,
    read_json,
    write_json,
)
import bedrock_text_client
import synthetic_match

# Shared on-disk layout: stage 2 writes generated/<qid>.json, this stage writes
# inspected/<qid>.json (module-level so tests can redirect them to a tmp dir).
SYNTHETIC_DIR = DATA_DIR / "synthetic"
GENERATED_DIR = SYNTHETIC_DIR / "generated"
INSPECTED_DIR = SYNTHETIC_DIR / "inspected"


def _generated_qids(only=None, limit=None) -> list[str]:
    """The generated qids to consider, in stable (sorted) order, after applying
    the calibration subset filters. Raises PipelineError if no generated
    artifacts exist yet (stage 2 must run first)."""
    if not GENERATED_DIR.is_dir():
        raise PipelineError(
            "no generated questions found; run generate_questions.py first"
        )
    qids = sorted(p.stem for p in GENERATED_DIR.glob("*.json"))
    if only:
        wanted = set(only)
        qids = [q for q in qids if q in wanted]
    if limit is not None:
        qids = qids[:limit]
    return qids


def _failed_artifact(qid: str, reason: str, *, model: str, prompt_version: str,
                     answer=None, steps=None, inspector_difficulty=None,
                     exactly_one_correct=None) -> dict:
    """A status='failed' Inspector_Result. inspectorIndex is null and
    answersAgree is False so triage flags the qid (Req 11.5)."""
    return {
        "qid": qid,
        "answer": answer,
        "steps": steps,
        "inspectorDifficulty": inspector_difficulty,
        "exactlyOneCorrect": exactly_one_correct,
        "inspectorIndex": None,
        "answersAgree": False,
        "model": model,
        "promptVersion": prompt_version,
        "status": "failed",
        "reason": reason,
    }


def inspect_all(only=None, limit=None) -> dict:
    """Cold-inspect every generated qid lacking an inspected artifact, running
    the deterministic answer match inline. Resumable. Returns counts."""
    inspected_dir = assert_within_data(INSPECTED_DIR)
    inspected_dir.mkdir(parents=True, exist_ok=True)

    qids = _generated_qids(only=only, limit=limit)
    inspected = skipped = failed = 0

    for qid in qids:
        out_path = inspected_dir / f"{qid}.json"
        if out_path.is_file():
            skipped += 1
            continue  # resumable (Req 11.6)

        generated = read_json(GENERATED_DIR / f"{qid}.json")

        # A Generator failure (no usable options) propagates as a failed
        # inspected artifact; the model is NOT called for it.
        if generated.get("status") == "failed":
            artifact = _failed_artifact(
                qid,
                "generated question failed (no usable options to inspect)",
                model=bedrock_text_client.INSPECTOR_MODEL,
                prompt_version=bedrock_text_client.COLD_SOLVE_PROMPT_VERSION,
            )
            write_json(out_path, artifact)
            failed += 1
            inspected += 1
            print(f"[inspect_questions] {qid}: FAILED (generated artifact failed)")
            continue

        text = generated.get("text")
        options = generated.get("options")

        # THE FIREWALL: cold_solve receives ONLY text + options. The Generator's
        # correctIndex is never passed (Req 3.1, 3.2).
        insp = bedrock_text_client.cold_solve(text, options)

        if insp.get("status") == "failed":
            artifact = _failed_artifact(
                qid,
                "cold_solve failed (Converse error or unparseable response)",
                model=insp.get("model", bedrock_text_client.INSPECTOR_MODEL),
                prompt_version=insp.get(
                    "promptVersion", bedrock_text_client.COLD_SOLVE_PROMPT_VERSION
                ),
            )
            write_json(out_path, artifact)
            failed += 1
            inspected += 1
            print(f"[inspect_questions] {qid}: FAILED (cold_solve)")
            continue

        # Stage 4 (pure) runs inline: map the Inspector's free-text answer to an
        # option index, then compare to the Generator's flagged index.
        answer = insp.get("answer")
        match_input = answer if isinstance(answer, str) else ("" if answer is None else str(answer))
        inspector_index = synthetic_match.match_inspector_answer(match_input, options)
        agree = synthetic_match.answers_agree(generated.get("correctIndex"), inspector_index)

        artifact = {
            "qid": qid,
            "answer": answer,
            "steps": insp.get("steps"),
            "inspectorDifficulty": insp.get("difficulty"),
            "exactlyOneCorrect": insp.get("exactlyOneCorrect"),
            "inspectorIndex": inspector_index,
            "answersAgree": agree,
            "model": insp.get("model", bedrock_text_client.INSPECTOR_MODEL),
            "promptVersion": insp.get(
                "promptVersion", bedrock_text_client.COLD_SOLVE_PROMPT_VERSION
            ),
            "status": "ok",
        }
        write_json(out_path, artifact)
        inspected += 1
        print(f"[inspect_questions] {qid}: answersAgree={agree} "
              f"inspectorIndex={inspector_index}")

    return {
        "selected": len(qids),
        "inspected": inspected,
        "skipped": skipped,
        "failed": failed,
    }


def _parse_only(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [s.strip() for s in value.split(",") if s.strip()]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Cold-inspect generated m6 questions and match answers (stage 3)."
    )
    ap.add_argument("--only", help="comma-separated generated qids to process (calibration subset)")
    ap.add_argument("--limit", type=int, help="process at most N generated questions")
    args = ap.parse_args(argv[1:])

    try:
        res = inspect_all(only=_parse_only(args.only), limit=args.limit)
    except PipelineError as e:
        print(f"[inspect_questions] {e}", file=sys.stderr)
        return 1

    print(f"[inspect_questions] selected {res['selected']}: inspected {res['inspected']}, "
          f"skipped {res['skipped']} (already done), failed {res['failed']} "
          f"-> synthetic/inspected/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
