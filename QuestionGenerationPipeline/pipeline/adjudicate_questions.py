"""
adjudicate_questions.py — stage 5 of the synthetic (m6) pipeline.

The Adjudicator (Qwen) is a third, independent model used ONLY as a tie-breaker
and ambiguity judge. It is deliberately expensive and is therefore invoked for a
Generated_Question IFF one of two triggers holds (Req 5.1, 5.2):

  - the two solvers DISAGREE — the Inspector's resolved cold answer did not match
    the Generator's flagged correctIndex (Inspector_Result `answersAgree` is not
    True); trigger label "answer_mismatch", OR
  - the item is AMBIGUOUS — the Inspector's "exactly one option correct?" check
    reported anything other than True (`exactlyOneCorrect is not True`); trigger
    label "ambiguity".

When NEITHER trigger holds the question is left alone and NO artifact is written
(the absence of an adjudicated/<qid>.json is itself the "agreed + unambiguous"
signal the bundle/triage relies on).

Resumability (Req 11.6): the per-qid artifact `synthetic/adjudicated/<qid>.json`
is the idempotency key. If it already exists the qid is skipped — no second
Adjudicator (Bedrock) call is ever made for the same slot.

Upstream failure handling: if the Generated_Question or Inspector_Result for a
qid is itself `status="failed"`, we do NOT call the model (there is nothing
coherent to adjudicate). Instead we record a minimal adjudicated artifact with
`trigger="upstream_failure"` and `status="failed"` so the join in stage 8 and
the triage in stage 7 can still see and flag it. (This is the simple, documented
choice: skip the model call on upstream failure but DO record a failed artifact
so the artifact exists for the bundle.)

On a normal invocation, a garbled Adjudicator response comes back from
`bedrock_text_client.adjudicate` as `status="failed"` with the raw text; that
failed verdict is STILL persisted (never silently dropped) so triage flags it
(Req 5.3).

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 9. adjudicate_questions.py" and the Adjudicator_Verdict data model.

Requirements: 5.1, 5.2, 5.3, 11.6.

Usage:
  data/.venv/bin/python data/pipeline/adjudicate_questions.py
  data/.venv/bin/python data/pipeline/adjudicate_questions.py --only q-m6-001,q-m6-002
  data/.venv/bin/python data/pipeline/adjudicate_questions.py --limit 5
"""

from __future__ import annotations

import argparse
import sys

from common import DATA_DIR, PipelineError, assert_within_data, read_json, write_json
import bedrock_text_client

# Stage inputs/outputs all live under data/synthetic/.
SYNTHETIC_DIR = DATA_DIR / "synthetic"
GENERATED_DIR = SYNTHETIC_DIR / "generated"
INSPECTED_DIR = SYNTHETIC_DIR / "inspected"
ADJUDICATED_DIR = SYNTHETIC_DIR / "adjudicated"


def _triggers(inspected: dict) -> list[str]:
    """Return the list of trigger labels that warrant Adjudication for an
    Inspector_Result, in a stable order. Empty list => no trigger => skip.

    - "answer_mismatch": the solvers disagree (answersAgree is not True).
    - "ambiguity": the Inspector reported not-exactly-one-correct
      (exactlyOneCorrect is not True).
    """
    reasons: list[str] = []
    if inspected.get("answersAgree") is not True:
        reasons.append("answer_mismatch")
    if inspected.get("exactlyOneCorrect") is not True:
        reasons.append("ambiguity")
    return reasons


def adjudicate_all(only=None, limit=None) -> dict:
    """Adjudicate the flagged Inspector_Results.

    Iterate the inspected qids (optionally scoped by --only qids / --limit N).
    For each qid:
      - skip if synthetic/adjudicated/<qid>.json already exists (resumable);
      - if the Generated_Question or Inspector_Result is status="failed" (or the
        generated artifact is missing), record a status="failed" artifact with
        trigger="upstream_failure" WITHOUT calling the model;
      - otherwise compute the triggers: invoke the Adjudicator IFF the solvers
        disagree OR the item is ambiguous; skip (write NO artifact) when neither
        trigger holds;
      - on invocation, call bedrock_text_client.adjudicate(...) and write the
        Adjudicator_Verdict (persisting a status="failed" verdict on parse
        failure so triage can flag it).

    Returns counts: {inspected, invoked, skipped_no_trigger, skipped_existing,
    failed}.
    """
    if not INSPECTED_DIR.is_dir():
        raise PipelineError(
            "no inspected questions found; run inspect_questions.py first "
            "(synthetic/inspected/ is missing)"
        )

    out_dir = assert_within_data(ADJUDICATED_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    only_set = set(only) if only else None

    qids = [p.stem for p in sorted(INSPECTED_DIR.glob("*.json"))]
    if only_set is not None:
        qids = [q for q in qids if q in only_set]
    if limit is not None:
        qids = qids[:limit]

    inspected_count = len(qids)
    invoked = skipped_no_trigger = skipped_existing = failed = 0

    for qid in qids:
        out_path = out_dir / f"{qid}.json"
        if out_path.is_file():
            skipped_existing += 1
            continue  # resumable: never re-adjudicate a slot (Req 11.6)

        inspected = read_json(INSPECTED_DIR / f"{qid}.json")
        gen_path = GENERATED_DIR / f"{qid}.json"
        generated = read_json(gen_path) if gen_path.is_file() else None

        # Upstream failure: a failed (or missing) generated artifact, or a failed
        # inspector result. Record a failed verdict WITHOUT calling the model so
        # the artifact exists for the bundle/triage to flag.
        if (generated is None
                or generated.get("status") == "failed"
                or inspected.get("status") == "failed"):
            write_json(out_path, {
                "qid": qid,
                "trigger": "upstream_failure",
                "status": "failed",
            })
            failed += 1
            print(f"[adjudicate_questions] FAILED {qid} "
                  f"(upstream_failure, recorded for triage)", file=sys.stderr)
            continue

        reasons = _triggers(inspected)
        if not reasons:
            # Agreed and unambiguous: leave it alone, write no artifact (Req 5.1/5.2).
            skipped_no_trigger += 1
            continue

        trigger = "+".join(reasons)

        # Guard the index before handing it to the model (options[index]).
        options = generated.get("options")
        correct_index = generated.get("correctIndex")
        if (not isinstance(options, list)
                or not isinstance(correct_index, int)
                or not (0 <= correct_index < len(options))):
            write_json(out_path, {
                "qid": qid,
                "trigger": trigger,
                "status": "failed",
            })
            failed += 1
            print(f"[adjudicate_questions] FAILED {qid} "
                  f"(unusable generated options/correctIndex)", file=sys.stderr)
            continue

        result = bedrock_text_client.adjudicate(
            generated.get("text"),
            options,
            correct_index,
            inspected.get("answer"),
        )

        if result.get("status") == "failed":
            write_json(out_path, {
                "qid": qid,
                "trigger": trigger,
                "status": "failed",
                "raw": result.get("raw"),
                "model": result.get("model"),
                "promptVersion": result.get("promptVersion"),
            })
            failed += 1
            print(f"[adjudicate_questions] FAILED {qid} "
                  f"(status=failed, persisted for triage)", file=sys.stderr)
            continue

        write_json(out_path, {
            "qid": qid,
            "trigger": trigger,
            "correctAnswer": result.get("correctAnswer"),
            "unresolved": result.get("unresolved"),
            "exactlyOneCorrect": result.get("exactlyOneCorrect"),
            "rationale": result.get("rationale"),
            "model": result.get("model"),
            "promptVersion": result.get("promptVersion"),
            "status": "ok",
        })
        invoked += 1
        print(f"[adjudicate_questions] adjudicated {qid} (trigger {trigger})")

    return {
        "inspected": inspected_count,
        "invoked": invoked,
        "skipped_no_trigger": skipped_no_trigger,
        "skipped_existing": skipped_existing,
        "failed": failed,
    }


def _parse_only(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [s.strip() for s in value.split(",") if s.strip()]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Adjudicate flagged synthetic m6 questions "
                    "(disagreement or ambiguity only) — stage 5."
    )
    ap.add_argument("--only", help="comma-separated synthetic qids (q-m6-NNN) to keep")
    ap.add_argument("--limit", type=int, help="adjudicate at most N inspected qids")
    args = ap.parse_args(argv[1:])

    try:
        res = adjudicate_all(only=_parse_only(args.only), limit=args.limit)
    except PipelineError as e:
        print(f"[adjudicate_questions] {e}", file=sys.stderr)
        return 1

    print(f"[adjudicate_questions] inspected {res['inspected']}: "
          f"invoked {res['invoked']}, skipped_no_trigger {res['skipped_no_trigger']}, "
          f"skipped_existing {res['skipped_existing']} (already done), "
          f"failed {res['failed']} -> synthetic/adjudicated/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
