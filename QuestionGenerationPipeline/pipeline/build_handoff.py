"""
build_handoff.py — assemble the deliverable from approved review decisions.

Reads data/review/<tag>-decisions.json for each booklet, keeps only `approve`
decisions, validates each against the product Question schema, copies approved
figures, and writes data/handoff/questions.json + data/handoff/figures/.

The output conforms to functions/src/shared/types.ts `Question` (plus optional
imageUrl). seedQuestions.ts destructures { id, ...data }, so including `id` is
compatible.

Usage:
  data/.venv/bin/python data/pipeline/build_handoff.py            # build from both booklets
  data/.venv/bin/python data/pipeline/build_handoff.py --check    # re-validate existing handoff only
  data/.venv/bin/python data/pipeline/build_handoff.py --allow-deletions  # override the diff guard

Requirements: 7.1-7.8, 8.1, 10.1, 10.2, 10.4.
"""

from __future__ import annotations

import base64
import re
import sys
import shutil
from typing import NamedTuple

from common import (
    WORK_DIR,
    REVIEW_DIR,
    HANDOFF_DIR,
    PipelineError,
    assert_within_data,
    load_sources,
    read_json,
    write_json,
)
# Module-level seam: imported here (not called inline) so tests can monkeypatch
# build_handoff.ensure_backup_or_abort with a stub and avoid a real backup.
from backup import ensure_backup_or_abort

TOPICS = {
    "number", "fractions_decimals_percentages", "ratio_proportion",
    "algebra", "geometry", "data_handling",
}
ALLOWED_FIELDS = {"id", "text", "options", "correctIndex", "topic", "difficulty",
                  "imageUrl", "imageDescription"}


# ---------------------------------------------------------------------------
# Schema validation (Property 5)
# ---------------------------------------------------------------------------

def validate_question(q: dict) -> list[str]:
    """Return a list of human-readable problems; empty means conformant."""
    problems = []
    if not isinstance(q.get("text"), str) or not q["text"].strip():
        problems.append("text must be a non-empty string")
    opts = q.get("options")
    if not isinstance(opts, list) or not all(isinstance(o, str) for o in opts):
        problems.append("options must be a list of strings")
        opts = []
    if any(o.strip() == "" for o in opts):
        problems.append("one or more options are empty")
    if q.get("topic") not in TOPICS:
        problems.append(f"topic {q.get('topic')!r} not in the six allowed values")
    if q.get("difficulty") not in (1, 2, 3, 4, 5):
        problems.append(f"difficulty {q.get('difficulty')!r} not in 1..5")
    ci = q.get("correctIndex")
    if not isinstance(ci, int) or ci < 0 or ci >= len(opts):
        problems.append(f"correctIndex {ci!r} out of bounds for {len(opts)} options")
    extra = set(q.keys()) - ALLOWED_FIELDS
    if extra:
        problems.append(f"nonconforming field(s): {sorted(extra)}")
    return problems


# ---------------------------------------------------------------------------
# Diff guard against destructive handoff change (Req 2.1-2.6, 2.9)
# ---------------------------------------------------------------------------

class Violation(NamedTuple):
    """One detected destructive change between the existing and prospective
    handoff. `kind` is one of the four change types below; `detail` is a
    human-readable description for the operator report."""
    qid: str
    kind: str   # "disappeared" | "count_drop" | "lost_image_url" | "lost_image_description"
    detail: str


def _has_field(q: dict, field: str) -> bool:
    """True when `q` carries a non-empty value for `field`."""
    if not isinstance(q, dict):
        return False
    value = q.get(field)
    if isinstance(value, str):
        return bool(value.strip())
    return value is not None


def diff_guard(existing: list[dict], prospective: list[dict]) -> list[Violation]:
    """Pure, in-memory comparison of two question lists (no IO).

    Detects, per Req 2.2-2.6, every destructive change between the existing
    handoff and the prospective one:
      - ``disappeared``: an approved question ``id`` present in ``existing`` but
        absent from ``prospective`` (Req 2.2).
      - ``count_drop``: the total number of questions in ``prospective`` is lower
        than in ``existing`` (Req 2.3); emitted once alongside the specific
        disappeared ids so the operator sees the headline drop.
      - ``lost_image_url``: a question that had a non-empty ``imageUrl`` in
        ``existing`` but lacks it (missing or empty) in ``prospective`` (Req 2.4).
      - ``lost_image_description``: a question that had a non-empty
        ``imageDescription`` in ``existing`` but lacks it now (Req 2.5).

    Protected-field presence (``imageUrl`` / ``imageDescription``) is read from
    ``existing`` ONLY — it is never required to be present in any decisions file
    (Req 2.9). All changes are detected in a single pass (not fail-fast) so the
    operator sees the full blast radius. Returns one ``Violation`` per detected
    change; an empty list means it is safe to overwrite.
    """
    existing_by_id: dict[str, dict] = {
        q["id"]: q for q in existing if isinstance(q, dict) and "id" in q
    }
    prospective_by_id: dict[str, dict] = {
        q["id"]: q for q in prospective if isinstance(q, dict) and "id" in q
    }

    violations: list[Violation] = []

    # Req 2.3: a lower total count is a destructive change on its own.
    if len(prospective) < len(existing):
        violations.append(Violation(
            qid="*",
            kind="count_drop",
            detail=(f"question count dropped from {len(existing)} to "
                    f"{len(prospective)}"),
        ))

    for qid in existing_by_id:
        old = existing_by_id[qid]
        new = prospective_by_id.get(qid)

        # Req 2.2: an approved id present before but gone now.
        if new is None:
            violations.append(Violation(
                qid=qid,
                kind="disappeared",
                detail=f"approved question {qid} present in existing handoff is "
                       f"absent from the prospective handoff",
            ))
            continue

        # Req 2.4: lost a figure that the existing handoff carried.
        if _has_field(old, "imageUrl") and not _has_field(new, "imageUrl"):
            violations.append(Violation(
                qid=qid,
                kind="lost_image_url",
                detail=f"{qid} lost its imageUrl "
                       f"(was {old.get('imageUrl')!r})",
            ))

        # Req 2.5/2.9: lost a description that the existing handoff carried.
        if _has_field(old, "imageDescription") and not _has_field(new, "imageDescription"):
            violations.append(Violation(
                qid=qid,
                kind="lost_image_description",
                detail=f"{qid} lost its imageDescription",
            ))

    return violations


def report_violations(violations: list[Violation]) -> None:
    """Print every detected destructive change to stderr, grouped by kind, each
    identified by its question id and change type (Req 2.6). Reports the full
    set in one pass so the operator sees the entire blast radius."""
    if not violations:
        return

    by_kind: dict[str, list[Violation]] = {}
    for v in violations:
        by_kind.setdefault(v.kind, []).append(v)

    print(f"[build_handoff] diff guard: {len(violations)} destructive "
          f"change(s) detected", file=sys.stderr)
    for kind in sorted(by_kind):
        group = by_kind[kind]
        print(f"  {kind} ({len(group)}):", file=sys.stderr)
        for v in group:
            print(f"    {v.qid}: {v.detail}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Figure handling
# ---------------------------------------------------------------------------

def _save_figure(qid: str, figure: dict | None, tag: str, figures_out) -> str | None:
    """Copy/decode the approved figure into handoff/figures/<qid>.png.
    Returns the relative imageUrl or None."""
    if not figure:
        return None
    dest = assert_within_data(figures_out / f"{qid}.png")
    src_kind = figure.get("source")
    if src_kind in ("recrop", "attached") and figure.get("dataUrl"):
        m = re.match(r"data:image/\w+;base64,(.+)", figure["dataUrl"], re.DOTALL)
        if not m:
            return None
        dest.write_bytes(base64.b64decode(m.group(1)))
        return f"figures/{qid}.png"
    if figure.get("name"):
        src = WORK_DIR / tag / "figures" / figure["name"]
        if src.is_file():
            shutil.copyfile(src, dest)
            return f"figures/{qid}.png"
    return None


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build_handoff(allow_deletions: bool = False) -> dict:
    figures_out = assert_within_data(HANDOFF_DIR / "figures")
    figures_out.mkdir(parents=True, exist_ok=True)

    # Read the existing handoff once. It serves two independent purposes:
    #   1. the imageDescription re-attach below (preserves any folded-in
    #      descriptions across a rebuild), and
    #   2. the diff guard comparison just before the overwrite (Req 2.1).
    qpath_existing = HANDOFF_DIR / "questions.json"
    existing_questions: list[dict] = read_json(qpath_existing) if qpath_existing.is_file() else []

    # Preserve any imageDescription folded in by the figure-description pipeline.
    # build_handoff rebuilds questions.json from review decisions, which do NOT
    # carry descriptions; without this, a rebuild would silently wipe any
    # previously folded-in descriptions. We re-attach by qid after building.
    existing_descriptions: dict[str, str] = {
        q["id"]: q["imageDescription"]
        for q in existing_questions
        if isinstance(q, dict) and q.get("imageDescription") and "id" in q
    }

    questions: list[dict] = []
    excluded: list[dict] = []

    # Iterate the source slugs from the registry (q ids are namespaced by slug).
    for tag in load_sources():
        decisions_path = REVIEW_DIR / f"{tag}-decisions.json"
        if not decisions_path.is_file():
            print(f"[build_handoff] note: no decisions file for {tag} "
                  f"({decisions_path.name}); skipping", file=sys.stderr)
            continue
        decisions = read_json(decisions_path)
        for qid, d in decisions.items():
            if d.get("decision") != "approve":
                continue  # approved-only (Property 4)
            image_url = _save_figure(qid, d.get("figure"), tag, figures_out)
            q = {
                "id": qid,
                "text": (d.get("stem") or "").strip(),
                "options": [o for o in (d.get("options") or [])],
                "correctIndex": d.get("correctIndex"),
                "topic": d.get("topic"),
                "difficulty": d.get("difficulty"),
            }
            if image_url:
                q["imageUrl"] = image_url
            # re-attach a preserved description (only meaningful for image qs)
            if image_url and qid in existing_descriptions:
                q["imageDescription"] = existing_descriptions[qid]
            problems = validate_question(q)
            if problems:
                excluded.append({"id": qid, "problems": problems})
                # don't leave an orphan figure for an excluded question
                orphan = figures_out / f"{qid}.png"
                if image_url and orphan.is_file():
                    orphan.unlink()
                continue
            questions.append(q)

    questions.sort(key=lambda q: q["id"])

    # Req 5.1: a verified backup is a HARD PRECONDITION of any overwrite. Run it
    # once per build_handoff invocation, before the diff guard and write_json so
    # the prior durable state (including the existing handoff) is recoverable
    # before we mutate anything. If the backup cannot be created and verified,
    # ensure_backup_or_abort raises PipelineError and build_handoff aborts here
    # with no overwrite (Req 5.2). The --check path never reaches this code, so
    # it never triggers a backup.
    ensure_backup_or_abort()

    # Req 2.1: compare the prospective handoff against the existing one BEFORE
    # any overwrite. The guard is an independent safety layer on top of the
    # imageDescription re-attach above.
    violations = diff_guard(existing_questions, questions)
    if violations:
        report_violations(violations)
        if not allow_deletions:
            # Req 2.2-2.6, 2.8: abort with no overwrite, naming each change.
            raise PipelineError(
                f"diff guard: {len(violations)} destructive change(s); "
                f"pass --allow-deletions to override"
            )
        # Req 2.7: override supplied — the reported changes are warnings only and
        # the overwrite proceeds.
        print("[build_handoff] --allow-deletions supplied: overriding the diff "
              "guard and proceeding with the overwrite", file=sys.stderr)

    write_json(HANDOFF_DIR / "questions.json", questions)

    rt = check_round_trip(questions, figures_out)
    return {"written": len(questions), "excluded": excluded, "roundTrip": rt}


def check_round_trip(questions, figures_out) -> dict:
    """Every imageUrl has a file; warn on orphan figure files (Property 6)."""
    referenced = set()
    missing = []
    for q in questions:
        if "imageUrl" in q:
            name = q["imageUrl"].split("/")[-1]
            referenced.add(name)
            if not (figures_out / name).is_file():
                missing.append(q["id"])
    on_disk = {p.name for p in figures_out.iterdir() if p.suffix == ".png"} if figures_out.is_dir() else set()
    orphans = sorted(on_disk - referenced)
    return {"missing": missing, "orphans": orphans}


def check_only() -> dict:
    """Re-validate an existing handoff without rebuilding (Req 7.8, 10.4)."""
    qpath = HANDOFF_DIR / "questions.json"
    if not qpath.is_file():
        raise PipelineError("no handoff/questions.json to check; run without --check first")
    questions = read_json(qpath)
    figures_out = HANDOFF_DIR / "figures"
    bad = []
    for q in questions:
        problems = validate_question(q)
        if problems:
            bad.append({"id": q.get("id"), "problems": problems})
    rt = check_round_trip(questions, figures_out)
    return {"count": len(questions), "bad": bad, "roundTrip": rt}


def main(argv: list[str]) -> int:
    try:
        if "--check" in argv:
            res = check_only()
            print(f"[build_handoff] --check: {res['count']} questions")
            if res["bad"]:
                print(f"  NON-CONFORMING: {res['bad']}", file=sys.stderr)
            if res["roundTrip"]["missing"]:
                print(f"  MISSING FIGURES: {res['roundTrip']['missing']}", file=sys.stderr)
            if res["roundTrip"]["orphans"]:
                print(f"  orphan figure files: {res['roundTrip']['orphans']}", file=sys.stderr)
            return 1 if (res["bad"] or res["roundTrip"]["missing"]) else 0

        res = build_handoff(allow_deletions=("--allow-deletions" in argv))
    except PipelineError as e:
        print(f"[build_handoff] {e}", file=sys.stderr)
        return 1

    print(f"[build_handoff] wrote {res['written']} questions -> handoff/questions.json")
    if res["excluded"]:
        print(f"  excluded {len(res['excluded'])} non-conforming:", file=sys.stderr)
        for e in res["excluded"]:
            print(f"    {e['id']}: {e['problems']}", file=sys.stderr)
    if res["roundTrip"]["orphans"]:
        print(f"  orphan figure files (not referenced): {res['roundTrip']['orphans']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
