"""Property-based test for backup snapshot file selection.

PROPERTY-BASED TEST (hypothesis, >=100 iterations).

Property 4: Snapshot file selection equals durable trees minus excluded trees.
For any data/-like tree, ``select_files(root, DURABLE_TREES)`` equals exactly
every file under ``sources/``, ``review/``, ``handoff/`` and contains no file
under ``work/`` or ``.venv/``.

**Validates: Requirements 4.2, 4.3**
"""

import tempfile
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backup import CACHE_DIR_NAMES, DURABLE_TREES, EXCLUDED_TREES, select_files


# Top-level trees a generated file may live under. Mixes the durable set, the
# excluded set, and a few unrelated trees that must never be selected.
TOP_LEVEL = ["sources", "review", "handoff", "work", ".venv", "descriptions", "other"]

# Directory segment names — deliberately disjoint from FILE_NAMES (these carry
# no extension) and none equal a reserved EXCLUDED_TREES name, so generated
# intermediate dirs never coincide with a file path or an excluded directory.
DIR_SEGMENTS = ["a", "b", "sub", "deep", "nested", "figures", "alpha", "q-m1-002"]

# Leaf file names — all contain a '.', so a file path can never be an ancestor
# directory of another generated file path.
FILE_NAMES = ["questions.json", "fig.png", "data.txt", "q-m1-002.json", "x.bin"]


# A single file spec: a top-level tree, 0-3 intermediate directory segments,
# and a leaf file name. Rendered to a POSIX-relative path like
# "sources/sub/deep/fig.png".
_file_spec = st.tuples(
    st.sampled_from(TOP_LEVEL),
    st.lists(st.sampled_from(DIR_SEGMENTS), min_size=0, max_size=3),
    st.sampled_from(FILE_NAMES),
)


def _render(spec) -> str:
    top, mids, name = spec
    return "/".join([top, *mids, name])


# A tree is a (deduplicated) set of relative file paths. min_size=1 guarantees
# at least one file so trivial empty trees don't dominate the examples.
trees = st.lists(_file_spec, min_size=1, max_size=25).map(
    lambda specs: sorted({_render(s) for s in specs})
)


@settings(max_examples=200)
@given(rel_paths=trees)
def test_select_files_equals_durable_minus_excluded(rel_paths):
    # A fresh temp tree per example: tmp_path (function-scoped) would otherwise
    # be shared across hypothesis examples and accumulate files.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"

        # Materialize the random tree as real files under the temp dir.
        for rel in rel_paths:
            f = root / Path(rel)
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(b"x")

        selected = select_files(root, DURABLE_TREES)
        selected_rel = {p.relative_to(root.resolve()).as_posix() for p in selected}

        # Independently computed expectation: every file whose top-level tree is
        # a durable tree (sources/, review/, handoff/). Generated intermediate
        # segments are never excluded names, so top-level membership decides it.
        expected_rel = {r for r in rel_paths if r.split("/", 1)[0] in DURABLE_TREES}

        # Property 4: selection equals durable trees minus excluded trees (Req 4.2).
        assert selected_rel == expected_rel

        # No selected file lives under an excluded TOP-LEVEL tree (Req 4.3).
        # Exclusion is top-level only: a nested file/dir merely named "work" or
        # ".venv" inside a durable tree is still selected.
        for rel in selected_rel:
            assert rel.split("/", 1)[0] not in EXCLUDED_TREES

        # Every file actually under work/ or .venv/ is absent from the selection.
        excluded_rel = {r for r in rel_paths if r.split("/", 1)[0] in EXCLUDED_TREES}
        assert selected_rel.isdisjoint(excluded_rel)


# ---------------------------------------------------------------------------
# Cache-pruning unit tests (FIX 1): regenerable caches are excluded both at the
# top level (EXCLUDED_TREES) and wherever they appear nested as a path
# component (CACHE_DIR_NAMES), while a file literally NAMED like a tree is kept.
# ---------------------------------------------------------------------------

def _write(root: Path, rel: str, content: bytes = b"x") -> None:
    f = root / Path(rel)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(content)


def test_top_level_cache_trees_are_excluded(tmp_path):
    """`.pytest_cache/` and `.hypothesis/` at the top level are excluded, the
    same as `work/` and `.venv/` (FIX 1: EXCLUDED_TREES extended)."""
    assert {".pytest_cache", ".hypothesis"} <= set(EXCLUDED_TREES)

    root = tmp_path / "data"
    _write(root, "handoff/questions.json")
    _write(root, ".pytest_cache/v/cache/lastfailed")
    _write(root, ".hypothesis/examples/abc123")
    _write(root, "work/scratch.json")
    _write(root, ".venv/pyvenv.cfg")

    top_level = tuple(sorted(p.name for p in root.iterdir()))
    selected = {p.relative_to(root.resolve()).as_posix() for p in select_files(root, top_level)}

    assert selected == {"handoff/questions.json"}


def test_nested_cache_dirs_are_pruned_at_any_depth(tmp_path):
    """`__pycache__`, `.pytest_cache`, `.hypothesis` nested INSIDE a durable
    tree are pruned wherever they appear as a path component (FIX 1: nested
    pruning on CACHE_DIR_NAMES only)."""
    assert CACHE_DIR_NAMES == {"__pycache__", ".pytest_cache", ".hypothesis"}

    root = tmp_path / "data"
    # Real, keepable durable files.
    _write(root, "handoff/questions.json")
    _write(root, "sources/m1/booklet.pdf")
    # Nested caches that must be pruned even though they live under durable trees.
    _write(root, "handoff/__pycache__/x.pyc")
    _write(root, "sources/m1/__pycache__/deep/y.pyc")
    _write(root, "handoff/tests/.pytest_cache/v/cache/lastfailed")
    _write(root, "review/.hypothesis/examples/abc")

    selected = {
        p.relative_to(root.resolve()).as_posix()
        for p in select_files(root, DURABLE_TREES)
    }

    assert selected == {"handoff/questions.json", "sources/m1/booklet.pdf"}


def test_file_literally_named_work_is_still_backed_up(tmp_path):
    """A file (or nested dir) literally named like an EXCLUDED_TREE — e.g.
    `work` — inside a durable tree is STILL backed up. Nested pruning is scoped
    to the cache names ONLY; it is deliberately not generalised to
    EXCLUDED_TREES (the previously-fixed bug must not be reintroduced)."""
    root = tmp_path / "data"
    # A file literally named "work" under a durable tree.
    _write(root, "handoff/work", b"i am a real file named work")
    # A nested directory named "work" / ".venv" with a real file inside.
    _write(root, "sources/work/booklet.pdf", b"real")
    _write(root, "review/.venv/keep.json", b"real")

    selected = {
        p.relative_to(root.resolve()).as_posix()
        for p in select_files(root, DURABLE_TREES)
    }

    assert selected == {
        "handoff/work",
        "sources/work/booklet.pdf",
        "review/.venv/keep.json",
    }


def test_file_literally_named_pycache_is_kept_but_its_contents_are_not(tmp_path):
    """A file literally named `__pycache__` is kept (only the final component is
    a cache name, not an intermediate directory), but files INSIDE a
    `__pycache__` directory are pruned."""
    root = tmp_path / "data"
    _write(root, "handoff/__pycache__", b"a file, not a dir")  # kept
    _write(root, "sources/__pycache__/compiled.pyc", b"pruned")  # pruned

    selected = {
        p.relative_to(root.resolve()).as_posix()
        for p in select_files(root, DURABLE_TREES)
    }

    assert selected == {"handoff/__pycache__"}
