"""
answer_match.py — pure answer-to-option matching helpers.

Deterministic normalization tiers (letter, exact, loose, numeric) that map a
free-text answer string onto exactly one option index, plus the option-letter
table. These are pure string helpers: no IO, no network, no global state.

Used by the synthetic (m6) pipeline:
  - synthetic_match.match_inspector_answer reuses match_answer + OPTION_LETTERS
  - synthetic_dedup.normalize_question reuses _norm / _norm_loose

`match_answer(raw, options)` returns `(index_or_None, confidence)` where
confidence is "high" | "medium" | "none"; the index is `None` whenever zero or
more than one option matches in every tier.
"""

from __future__ import annotations

import re
from fractions import Fraction

OPTION_LETTERS = ["A", "B", "C", "D", "E"]


def _norm(s: str) -> str:
    """Tight normalisation: lowercase, collapse whitespace, strip surrounding
    punctuation/spaces."""
    s = s.strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _norm_loose(s: str) -> str:
    """Looser normalisation: drop common unit suffixes and spaces/punctuation
    so '6 cm' ~ '6', '40.5°c' ~ '40.5'."""
    s = _norm(s)
    s = re.sub(r"[£%°]", "", s)
    s = re.sub(r"\b(cm|mm|m|km|kg|g|ml|l|litres?|hours?|mins?|minutes?|weeks?|"
               r"days?|millilitres?|degrees?|boys?|girls?)\b", "", s)
    s = re.sub(r"[\s,]", "", s)
    return s.strip()


def _to_number(s: str):
    """Best-effort numeric value of a string: handles ints, decimals, and
    a/b fractions. Returns a Fraction or None."""
    s = s.strip()
    s = re.sub(r"[£%°,]", "", s)
    s = re.sub(r"\s+", "", s)
    try:
        if "/" in s:
            return Fraction(s)
        if re.fullmatch(r"-?\d+(\.\d+)?", s):
            return Fraction(s)
    except (ValueError, ZeroDivisionError):
        return None
    return None


def match_answer(raw: str, options: list[str]) -> tuple[int | None, str]:
    """Return (correctIndex, confidence) where confidence is high|medium|none."""
    raw_stripped = raw.strip()

    # 1) bare option letter
    if raw_stripped.upper() in OPTION_LETTERS and len(raw_stripped) == 1:
        return OPTION_LETTERS.index(raw_stripped.upper()), "high"

    # 2) exact normalised string match (exactly one option)
    nraw = _norm(raw)
    exact = [i for i, o in enumerate(options) if _norm(o) == nraw]
    if len(exact) == 1:
        return exact[0], "high"

    # 3) loose normalised match (exactly one option)
    lraw = _norm_loose(raw)
    loose = [i for i, o in enumerate(options) if _norm_loose(o) == lraw and lraw != ""]
    if len(loose) == 1:
        return loose[0], "medium"

    # 4) numeric equality (exactly one option), e.g. 0.5 == 1/2
    rnum = _to_number(raw)
    if rnum is not None:
        numeric = [i for i, o in enumerate(options)
                   if (_to_number(o) is not None and _to_number(o) == rnum)]
        if len(numeric) == 1:
            return numeric[0], "medium"

    # zero or multiple matches
    return None, "none"
