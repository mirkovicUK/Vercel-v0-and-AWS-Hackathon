"""Property-based tests for the snapshot+manifest engine (backup.py).

PROPERTY-BASED TEST FILE (hypothesis, >=100 iterations).

Property 1: Manifest digest correctness
  For any directory tree, the manifest produced by `compute_manifest` has a
  `fileCount` equal to the number of files in the selected set, and for every
  file the recorded `sha256` equals the independently computed SHA-256 of that
  file's bytes (and `bytes` equals the file size).

**Validates: Requirements 1.2, 4.4**
"""

import hashlib
import shutil
import tempfile
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backup import EXCLUDED_TREES, compute_manifest, select_files


# A filesystem-safe path segment: letters, digits, underscore, hyphen. No dots,
# slashes, or reserved names, so segments can never be "." / ".." or collide
# with path separators.
_SEGMENT = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
    min_size=1,
    max_size=8,
)

# A relative path of 1..4 segments — gives varying nesting depth.
_REL_PATH = st.lists(_SEGMENT, min_size=1, max_size=4)

# A list of (relative-path-segments, content-bytes) entries. Binary content
# with max_size allowing 0 covers empty files and arbitrary binary blobs.
# Varying the number of entries covers varying file counts (including zero).
_TREE = st.lists(
    st.tuples(_REL_PATH, st.binary(min_size=0, max_size=1500)),
    min_size=0,
    max_size=12,
)


def _materialize(root: Path, entries: list[tuple[list[str], bytes]]) -> set[str]:
    """Write the generated entries under `root`, skipping any entry that would
    conflict with an already-created file/dir (e.g. one path is a prefix of
    another). Returns the set of POSIX-relative paths of files actually written.
    """
    written: set[str] = set()
    for segments, content in entries:
        rel = Path(*segments)
        target = root / rel
        # Skip if a parent on the way is already a file, or the target already
        # exists as a directory — these collisions are an artifact of random
        # path generation, not something the engine needs to handle.
        if any(p.is_file() for p in target.parents if root in p.parents or p == root):
            continue
        if target.exists():
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
        except (FileExistsError, NotADirectoryError):
            continue
        if target.parent.is_file():
            continue
        target.write_bytes(content)
        written.add(rel.as_posix())
    return written


@settings(max_examples=200)
@given(entries=_TREE)
def test_manifest_digest_correctness(entries):
    """Property 1: manifest fileCount matches the selected set, and every
    recorded sha256/bytes matches an independent computation of the file.

    **Validates: Requirements 1.2, 4.4**
    """
    # Fresh root per example (self-managed temp dir) so files never leak
    # between generated cases.
    root = Path(tempfile.mkdtemp(prefix="backup-prop-"))
    try:
        written = _materialize(root, entries)

        # Trees to select: every top-level entry under root that is not excluded.
        top_level = tuple(
            sorted(p.name for p in root.iterdir() if p.name not in EXCLUDED_TREES)
        )

        selected = select_files(root, top_level)
        manifest = compute_manifest(root, selected, trees=top_level)

        # The independently expected file set: everything we wrote whose
        # top-level segment is not an excluded tree.
        expected_paths = {
            rel for rel in written if rel.split("/", 1)[0] not in EXCLUDED_TREES
        }

        # select_files must find exactly the files we created (under
        # non-excluded trees) — no more, no fewer.
        selected_rel = {
            Path(p).resolve().relative_to(root.resolve()).as_posix()
            for p in selected
        }
        assert selected_rel == expected_paths

        # fileCount equals the number of selected files.
        assert manifest["fileCount"] == len(selected)
        assert manifest["fileCount"] == len(manifest["files"])

        # Every manifest entry's digest and size match an independent compute.
        for entry in manifest["files"]:
            file_path = root / entry["path"]
            raw = file_path.read_bytes()
            assert entry["sha256"] == hashlib.sha256(raw).hexdigest()
            assert entry["bytes"] == len(raw)

        # The manifest covers exactly the selected paths (no missing/extra).
        manifest_paths = {e["path"] for e in manifest["files"]}
        assert manifest_paths == expected_paths
    finally:
        shutil.rmtree(root, ignore_errors=True)
