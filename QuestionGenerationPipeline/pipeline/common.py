"""
Shared foundation for the synthetic question-generation pipeline.

Everything in this pipeline lives under the pipeline's data directory and must
never write outside it or make unexpected network calls. This module centralises:

  - the canonical data-directory paths (work / review / handoff trees),
  - the `assert_within_data` write guard,
  - the Sources_Registry loader (sources.json) — synthetic sources only,
  - the deterministic, collision-free question-id scheme,
  - small UTF-8 JSON read/write helpers (writes routed through the guard).

No import here performs or enables network IO.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple


class PipelineError(Exception):
    """Raised for any pipeline precondition failure (bad path, bad registry,
    etc.). Scripts catch this at the top level, print a one-line cause, and
    exit non-zero without partial writes."""


# ---------------------------------------------------------------------------
# Paths. This file is pipeline/common.py, so DATA_DIR is its grandparent
# (the Question_generation_pipeline root).
# ---------------------------------------------------------------------------

DATA_DIR: Path = Path(__file__).resolve().parent.parent
WORK_DIR: Path = DATA_DIR / "work"
REVIEW_DIR: Path = DATA_DIR / "review"
HANDOFF_DIR: Path = DATA_DIR / "handoff"


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def assert_within_data(p: Path | str) -> Path:
    """Resolve `p` and confirm it lies inside DATA_DIR. Returns the resolved
    path. Raises PipelineError if it escapes (e.g. via `..` or an absolute
    path elsewhere). Every write in the pipeline goes through this.
    """
    resolved = Path(p).resolve()
    data_root = DATA_DIR.resolve()
    if resolved != data_root and data_root not in resolved.parents:
        raise PipelineError(
            f"Refusing to operate on a path outside the data dir: {resolved} "
            f"(root is {data_root})"
        )
    return resolved


# ---------------------------------------------------------------------------
# Sources_Registry (sources.json). The synthetic pipeline declares a single
# generated source ("m6"). load_sources() parses and validates the registry;
# question_id() consults the declared slugs so ids are namespaced and stable.
# ---------------------------------------------------------------------------

SOURCES_PATH: Path = DATA_DIR / "sources.json"

# Synthetic sources are generated, not parsed from any document.
_VALID_PARSER_TYPES: frozenset[str] = frozenset({"synthetic"})


class Source(NamedTuple):
    """One declared source from sources.json (synthetic only)."""

    slug: str           # e.g. "m6"
    parser_type: str    # "synthetic"


def load_sources() -> dict[str, Source]:
    """Read sources.json and return {slug: Source}.

    Raises PipelineError on a missing/unreadable sources.json, an unknown
    `parserType`, or a duplicate slug.
    """
    if not SOURCES_PATH.is_file():
        raise PipelineError(
            f"Sources registry is missing: {SOURCES_PATH.name}"
        )

    try:
        registry = read_json(SOURCES_PATH)
    except (OSError, ValueError) as exc:
        raise PipelineError(f"Could not read {SOURCES_PATH.name}: {exc}") from exc

    entries = registry.get("sources") if isinstance(registry, dict) else None
    if not isinstance(entries, list):
        raise PipelineError(f"{SOURCES_PATH.name} must contain a 'sources' list")

    sources: dict[str, Source] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise PipelineError(f"Each source entry must be an object, got {entry!r}")

        slug = entry.get("slug")
        if not isinstance(slug, str) or not slug:
            raise PipelineError(f"Source entry is missing a non-empty 'slug': {entry!r}")
        if slug in sources:
            raise PipelineError(f"Duplicate source slug in {SOURCES_PATH.name}: {slug!r}")

        parser_type = entry.get("parserType")
        if parser_type not in _VALID_PARSER_TYPES:
            raise PipelineError(
                f"Unknown parserType {parser_type!r} for slug {slug!r}; "
                f"expected one of {sorted(_VALID_PARSER_TYPES)}"
            )

        sources[slug] = Source(slug=slug, parser_type=parser_type)

    if not sources:
        raise PipelineError(f"{SOURCES_PATH.name} declares no sources")

    return sources


@lru_cache(maxsize=1)
def _known_slugs() -> frozenset[str]:
    """Cached set of declared source slugs (from sources.json)."""
    return frozenset(load_sources())


# ---------------------------------------------------------------------------
# Identifiers
# ---------------------------------------------------------------------------

def question_id(source_tag: str, number: int) -> str:
    """Deterministic, stable, collision-free question id.

    Scheme: q-<tag>-<number:03d>  e.g. question_id("m6", 2) -> "q-m6-002".
    The tag must be a slug declared in sources.json.
    """
    slugs = _known_slugs()
    if source_tag not in slugs:
        raise PipelineError(
            f"Unknown source tag {source_tag!r}; expected one of {sorted(slugs)}"
        )
    if not isinstance(number, int) or number < 1:
        raise PipelineError(f"Question number must be a positive int, got {number!r}")
    return f"q-{source_tag}-{number:03d}"


# ---------------------------------------------------------------------------
# JSON IO (UTF-8, pretty). Writes are guarded.
# ---------------------------------------------------------------------------

def read_json(p: Path | str):
    path = Path(p)
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(p: Path | str, obj) -> Path:
    """Write `obj` as pretty UTF-8 JSON. The destination is checked with
    assert_within_data first, and parent dirs are created."""
    path = assert_within_data(p)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path
