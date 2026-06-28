"""
synthetic_match.py — stage 4 of the synthetic (m6) pipeline (pure).

Deterministically map the Inspector's free-text cold answer onto one of the
five option indices, and compare that resolved index against the Generator's
flagged correct-answer index. Answer agreement is therefore *reproducible* and
computed in our own code — never judged by a model.

The mapping reuses `answer_match.match_answer`, the same deterministic
normalization tiers (letter, exact, loose, numeric). That helper
already enforces the "exactly one option matches" rule per tier and returns
`(index_or_None, confidence)`; we keep only the index, which is `None` whenever
zero or more than one option matched.

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 8. synthetic_match.py" and Requirements 4.1, 4.2, 4.3, 4.4.

This module is pure: no IO, no network, no global state.
"""

from __future__ import annotations

import re

import answer_match

# The Inspector sometimes returns its answer as an option letter PREFIX plus the
# option text, e.g. "B) £23,460", "C. 800", "(A)", "B -", "D:". The dry run
# showed these resolving to None via answer_match.match_answer (its letter
# tier only accepts a BARE single letter), producing FALSE answer_mismatch flags
# even when the Inspector actually agreed. We strip a leading option-letter
# prefix here BEFORE delegating. The delimiter requirement (")"/"."/":"/"-"/
# whitespace after the letter, or the whole string being just the letter) keeps
# a free-text answer like "Bananas" from being misread as option "B".
_LETTER_PREFIX_RE = re.compile(r"^\s*\(?([A-Ea-e])\)?[).\.:\-\s]")


def match_inspector_answer(insp_answer: str, options: list[str]) -> int | None:
    """Map the Inspector's free-text cold answer to an option index.

    First handles a leading option-letter prefix ("B) £23,460", "C. 800",
    "(A)", "B -", "D:") or a bare letter A-E: the letter is mapped to an index
    (A->0 .. E->4) and returned directly when that index is within range of
    ``options``. Otherwise delegates to ``answer_match.match_answer``,
    applying the normalization tiers in order (letter, exact, loose, numeric)
    and returning the matched index iff exactly one option matches; returns
    ``None`` when nothing resolves uniquely.
    """
    if isinstance(insp_answer, str):
        stripped = insp_answer.strip()
        letter = None
        # whole string is exactly a bare letter A-E
        if len(stripped) == 1 and stripped.upper() in answer_match.OPTION_LETTERS:
            letter = stripped.upper()
        else:
            m = _LETTER_PREFIX_RE.match(insp_answer)
            if m:
                letter = m.group(1).upper()
        if letter is not None:
            idx = answer_match.OPTION_LETTERS.index(letter)
            if 0 <= idx < len(options):
                return idx

    idx, _confidence = answer_match.match_answer(insp_answer, options)
    return idx


def answers_agree(gen_index: int, insp_index: int | None) -> bool:
    """Return True iff the Inspector resolved to an index that equals the
    Generator's flagged correct-answer index. A ``None`` inspector index
    (no unique match) never agrees."""
    return insp_index is not None and insp_index == gen_index
