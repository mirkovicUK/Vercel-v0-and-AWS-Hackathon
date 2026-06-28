"""
The q-m6 synthetic question-id scheme (pure).

Each generation seed is assigned a 1-based *ordinal* by its position in the
stable seed-selection order. A seed's five difficulty slots map to five
consecutive question numbers; difficulty `d in 1..5` picks the offset within
the seed's block:

    number = (seed_ordinal - 1) * 5 + difficulty

This is a bijection from `(seed_ordinal, difficulty)` pairs onto the contiguous
range `1..5N` (so 102 seeds yield q-m6-001 .. q-m6-510), which gives the three
guarantees the synthetic pipeline relies on:

  - distinct (ordinal, difficulty) pairs always map to distinct numbers
    (no collisions);
  - the same pair always maps to the same `q-m6-NNN` across reruns
    (stable, resumable);
  - ids are derived only from the ordinal and difficulty -- no random and no
    wall-clock input -- so a resumed run recomputes identical ids.

`synthetic_qid` layers the existing `question_id("m6", n)` scheme on top, which
namespaces the number under the `m6` slug. `m6` must already be registered in
sources.json for `question_id` to accept it.

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 2. synthetic_ids.py" and Requirement 9.4.

This module is pure: no IO, no network, no global state.
"""

from __future__ import annotations

from common import PipelineError, question_id

# The five difficulty levels every seed is expanded across (1..5).
DIFFICULTIES = (1, 2, 3, 4, 5)


def slot_number(seed_ordinal: int, difficulty: int) -> int:
    """Map a (1-based seed ordinal, difficulty in 1..5) pair to its question
    number: ``(seed_ordinal - 1) * 5 + difficulty``.

    For 102 seeds this covers the contiguous range 1..510. Raises PipelineError
    if ``seed_ordinal`` is less than 1 or ``difficulty`` is not one of 1..5.
    """
    if seed_ordinal < 1:
        raise PipelineError(f"seed_ordinal must be >= 1, got {seed_ordinal}")
    if difficulty not in DIFFICULTIES:
        raise PipelineError(f"difficulty must be 1..5, got {difficulty}")
    return (seed_ordinal - 1) * 5 + difficulty


def synthetic_qid(seed_ordinal: int, difficulty: int) -> str:
    """Return the stable, collision-free ``q-m6-NNN`` id for a seed ordinal and
    difficulty. Equivalent to ``question_id("m6", slot_number(...))``."""
    return question_id("m6", slot_number(seed_ordinal, difficulty))
