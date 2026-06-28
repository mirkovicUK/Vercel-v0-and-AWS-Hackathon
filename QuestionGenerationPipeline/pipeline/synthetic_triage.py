"""
synthetic_triage.py — stage 7 of the m6 pipeline (pure, no network).

The heart of the safety model: the Triage_Verdict is computed IN OUR CODE from
artifact fields and is NEVER
read from any model. A misbehaving Generator/Inspector/Adjudicator that tries
to mark its own output approved cannot — the verdict here is the only authority.

`derive_triage(...)` returns one of two verdicts:

  - `"green"`  — auto-approved. Requires ALL of: the two solvers agree on the
    answer, exactly one option is correct, the difficulty estimates are within
    DIFFICULTY_TOLERANCE, the question is not a near-duplicate, and no Bedrock
    call or response parse failed.
  - `"flagged"` — requires human review, with one stable reason string per
    failing condition. Disagreement flags but NEVER auto-rejects: there is no
    `"rejected"` verdict, so nothing is ever dropped automatically.

Requirements: 6.1, 6.2, 6.3, 6.4, 11.5.
"""

from __future__ import annotations

# Maximum allowed absolute gap between the Generator and Inspector difficulty
# estimates for a `green` verdict. Tunable after the calibration run.
DIFFICULTY_TOLERANCE = 2


def derive_triage(
    *,
    answers_agree: bool,
    exactly_one_correct: bool,
    gen_difficulty: int,
    insp_difficulty: int,
    is_duplicate: bool,
    had_failure: bool,
) -> tuple[str, list[str]]:
    """Compute the Triage_Verdict in OUR code (never from a model).

    Returns ``("green", [])`` iff ALL of:
      - ``answers_agree`` (Generator and Inspector resolved to the same index),
      - ``exactly_one_correct`` (the Inspector ambiguity check passed),
      - ``abs(gen_difficulty - insp_difficulty) <= DIFFICULTY_TOLERANCE``,
      - ``not is_duplicate`` (no near-duplicate detected in the batch),
      - ``not had_failure`` (no Bedrock call or response parse failed).

    Otherwise returns ``("flagged", reasons)`` with one reason per failing
    condition, in a stable, deterministic order:
      - ``"answer_mismatch"``            when ``not answers_agree``,
      - ``"not_exactly_one_correct"``    when ``not exactly_one_correct``,
      - ``"difficulty_gap"``             when the difficulty gap exceeds tolerance,
      - ``"duplicate"``                  when ``is_duplicate``,
      - ``"bedrock_or_parse_failure"``   when ``had_failure``.

    There is no ``"rejected"`` verdict: disagreement flags for the human but is
    never auto-rejected (Req 6.4, 11.5).
    """
    reasons: list[str] = []

    if not answers_agree:
        reasons.append("answer_mismatch")
    if not exactly_one_correct:
        reasons.append("not_exactly_one_correct")
    if abs(gen_difficulty - insp_difficulty) > DIFFICULTY_TOLERANCE:
        reasons.append("difficulty_gap")
    if is_duplicate:
        reasons.append("duplicate")
    if had_failure:
        reasons.append("bedrock_or_parse_failure")

    if reasons:
        return ("flagged", reasons)
    return ("green", [])
