"""
seed_selector.py — stage 1 of the synthetic (m6) pipeline.

Reads the hardened handoff bank (`data/handoff/questions.json`) and selects
every *figure-less* question to use as a generation Seed. A question is
figure-less when it has no `imageUrl` field or an empty `imageUrl` value
(`is_figure_less`).

Each selected seed is assigned a 1-based `ordinal` by its position in the FULL
figure-less selection, in the handoff file's existing order. Ordinals are
assigned BEFORE any `--only`/`--limit` filtering, so a Calibration_Subset run
(a 5-seed dry run) produces exactly the same ordinals — and therefore the same
`q-m6-NNN` ids downstream — as the corresponding seeds in the full 102-seed
run. Each seed inherits its source question's `topic` (stamped onto every
Generated_Question) and carries its question `text` (the Generator needs it).

The Calibration_Subset filter applies `--only` (keep only those qids) and then
`--limit` (the first N of what remains), after ordinals are fixed.

If `handoff/questions.json` is missing or unreadable, a PipelineError naming
the file is raised and no seeds are produced.

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 3. seed_selector.py" and Requirements 1.1, 1.2, 1.3, 10.1.

This module performs no network IO and writes nothing; it only reads the
handoff bank.
"""

from __future__ import annotations

import argparse
import sys
from typing import NamedTuple

from common import HANDOFF_DIR, PipelineError, read_json


class Seed(NamedTuple):
    """One generation seed drawn from the figure-less handoff questions.

    qid:     the handoff seed's id (e.g. ``q-m1-001``).
    ordinal: 1-based position in the FULL figure-less selection (stable
             regardless of any --only/--limit filter).
    topic:   inherited onto every Generated_Question derived from this seed.
    text:    the seed question's text (the Generator needs it).
    """

    qid: str
    ordinal: int
    topic: str
    text: str


def is_figure_less(q: dict) -> bool:
    """True iff the question has no usable figure: a missing `imageUrl` field
    or an empty-string `imageUrl` both count as figure-less."""
    return not q.get("imageUrl")


def select_seeds(only: list[str] | None = None,
                 limit: int | None = None) -> list[Seed]:
    """Select figure-less handoff questions as generation seeds.

    Reads ``data/handoff/questions.json``, selects every figure-less question
    in the file's existing order, and assigns each a 1-based ``ordinal`` over
    the FULL figure-less set BEFORE applying any filter — so ordinals (and the
    derived q-m6 ids) are stable across a calibration subset and the full run.
    Each seed inherits its ``topic`` and carries its question ``text``.

    The Calibration_Subset filter is then applied: ``only`` keeps just those
    qids (preserving order and ordinals), and ``limit`` keeps the first N of
    what remains.

    Raises PipelineError naming ``handoff/questions.json`` if it is missing or
    unreadable, producing no seeds.
    """
    qpath = HANDOFF_DIR / "questions.json"
    if not qpath.is_file():
        raise PipelineError(
            "handoff/questions.json not found; run the extraction handoff first"
        )
    try:
        questions = read_json(qpath)
    except (OSError, ValueError) as exc:
        raise PipelineError(
            f"Could not read handoff/questions.json: {exc}"
        ) from exc

    # Assign ordinals over the FULL figure-less selection, in file order,
    # BEFORE any --only/--limit filtering (ordinals must be filter-stable).
    seeds: list[Seed] = []
    ordinal = 0
    for q in questions:
        if not is_figure_less(q):
            continue
        ordinal += 1
        seeds.append(Seed(
            qid=q["id"],
            ordinal=ordinal,
            topic=q.get("topic", ""),
            text=q.get("text", ""),
        ))

    # Calibration_Subset: --only (qids), then --limit (first N).
    if only:
        wanted = set(only)
        seeds = [s for s in seeds if s.qid in wanted]
    if limit is not None:
        seeds = seeds[:limit]

    return seeds


def _parse_only(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [s.strip() for s in value.split(",") if s.strip()]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Select figure-less handoff questions as m6 generation seeds (stage 1)."
    )
    ap.add_argument("--only", help="comma-separated handoff qids to keep (calibration subset)")
    ap.add_argument("--limit", type=int, help="keep at most N seeds")
    args = ap.parse_args(argv[1:])

    try:
        seeds = select_seeds(only=_parse_only(args.only), limit=args.limit)
    except PipelineError as e:
        print(f"[seed_selector] {e}", file=sys.stderr)
        return 1

    print(f"[seed_selector] selected {len(seeds)} seed(s):")
    for s in seeds:
        print(f"  #{s.ordinal:>3} {s.qid}  topic={s.topic}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
