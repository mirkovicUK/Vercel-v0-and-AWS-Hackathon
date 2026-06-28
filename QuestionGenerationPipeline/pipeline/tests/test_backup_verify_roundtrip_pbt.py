"""Property-based test for the manifest verify round-trip (backup.py).

PROPERTY-BASED TEST (hypothesis, >=100 iterations).

Property 2: Manifest verify round-trip on an untouched tree.
  For any directory tree, computing its manifest with ``compute_manifest`` and
  then verifying the SAME, unmodified tree against that manifest with
  ``verify_snapshot`` always reports success.

The real ``verify_snapshot`` shells out to the ``gcloud storage`` CLI to
bulk-download the uploaded snapshot in ONE call and then recomputes each
file's SHA-256 locally. Here we inject a fake, in-memory "bucket" via the
``runner`` hook so the round-trip runs with no network and no real bucket. The
fake honours the single recursive operation the engine uses:

  * ``rsync --recursive <local> gs://...`` — upload: copy local bytes into the
    fake store.
  * ``rsync --recursive gs://... <local>`` — download: copy every stored object
    under the prefix back to disk.

With an honest fake bucket and an untouched tree, verification must pass every
single time.

**Validates: Requirements 1.3, 4.6, 6.2**
"""

import json
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backup import (
    EXCLUDED_TREES,
    _MANIFEST_NAME,
    _gs_join,
    compute_manifest,
    select_files,
    snapshot_prefix,
    verify_snapshot,
)
from common import DATA_DIR


# A filesystem-safe path segment: letters, digits, underscore, hyphen. No dots,
# slashes, or reserved names, so a segment can never be "." / ".." or collide
# with a path separator.
_SEGMENT = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
    min_size=1,
    max_size=8,
)

# A relative path of 1..4 segments — varying nesting depth.
_REL_PATH = st.lists(_SEGMENT, min_size=1, max_size=4)

# (relative-path-segments, content-bytes) entries. Binary content with
# min_size=0 covers empty files and arbitrary binary blobs; varying the number
# of entries covers varying file counts (including zero).
_TREE = st.lists(
    st.tuples(_REL_PATH, st.binary(min_size=0, max_size=1500)),
    min_size=0,
    max_size=12,
)


def _materialize(root: Path, entries: list[tuple[list[str], bytes]]) -> set[str]:
    """Write the generated entries under `root`, skipping any entry that would
    collide with an already-created file/dir (e.g. one path is a prefix of
    another). Returns the POSIX-relative paths actually written. This mirrors
    the sibling backup property tests' tree builder.
    """
    written: set[str] = set()
    for segments, content in entries:
        rel = Path(*segments)
        target = root / rel
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


class _FakeBucket:
    """An honest in-memory stand-in for the Cloud Storage bucket.

    Maps ``gs://...`` object paths to their bytes. Its ``run`` method matches
    the ``runner`` contract used by backup.py: it receives the full argv
    (already prefixed with ``["gcloud", "storage", ...]``) and returns a
    ``subprocess.CompletedProcess``. verify_snapshot now bulk-downloads the
    whole snapshot in ONE call, so the fake models a single recursive
    ``rsync`` between the store and the local filesystem (either direction).
    """

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def run(self, argv: list[str]) -> subprocess.CompletedProcess:
        assert argv[:2] == ["gcloud", "storage"], argv
        op = argv[2]

        if op == "rsync":
            args = [a for a in argv[3:] if a != "--recursive"]
            src, dst = args[0], args[1]
            if src.startswith("gs://"):
                # Download: store -> local dir.
                base = src.rstrip("/") + "/"
                for key, content in list(self.store.items()):
                    if not key.startswith(base):
                        continue
                    local = Path(dst) / key[len(base):]
                    local.parent.mkdir(parents=True, exist_ok=True)
                    local.write_bytes(content)
            else:
                # Upload: local dir -> store.
                base = dst.rstrip("/") + "/"
                srcdir = Path(src)
                for p in srcdir.rglob("*"):
                    if p.is_file():
                        self.store[base + p.relative_to(srcdir).as_posix()] = (
                            p.read_bytes()
                        )
            return subprocess.CompletedProcess(argv, 0, "", "")

        return subprocess.CompletedProcess(argv, 1, "", f"unsupported op: {op}")


@settings(max_examples=200)
@given(entries=_TREE)
def test_verify_roundtrip_on_untouched_tree(entries):
    """Property 2: manifest + verify against the unmodified tree always passes.

    **Validates: Requirements 1.3, 4.6, 6.2**
    """
    # Fresh per-example source tree in a self-managed temp dir (NOT the shared
    # pytest tmp_path), so files never leak between generated cases.
    with tempfile.TemporaryDirectory(prefix="backup-roundtrip-") as tmp:
        root = Path(tmp)
        _materialize(root, entries)

        # Select every top-level (non-excluded) tree, exactly as a full backup
        # would, and build the manifest the engine would upload.
        top_level = tuple(
            sorted(p.name for p in root.iterdir() if p.name not in EXCLUDED_TREES)
        )
        files = select_files(root, top_level)
        manifest = compute_manifest(root, files, trees=top_level)

        prefix = snapshot_prefix(datetime(2025, 2, 14, 9, 15))

        # Stage the snapshot directly into the honest fake bucket: every
        # selected file plus the manifest lands under the prefix, exactly as a
        # completed bulk upload would leave it.
        bucket = _FakeBucket()
        base = prefix.rstrip("/") + "/"
        for entry in manifest["files"]:
            rel = entry["path"]
            bucket.store[base + rel] = (root / rel).read_bytes()
        bucket.store[base + _MANIFEST_NAME] = json.dumps(manifest).encode("utf-8")
        # The manifest object must be present, distinct from the data objects.
        assert any(k.endswith(_MANIFEST_NAME) for k in bucket.store)

        # verify_snapshot re-downloads into a guarded temp dir, which must live
        # inside the real data/ tree (assert_within_data). Use a unique dir
        # under the excluded work/ tree so it never pollutes a real snapshot.
        verify_dir = DATA_DIR / "work" / "_verify_roundtrip_pbt" / uuid.uuid4().hex
        try:
            # Property 2: an untouched tree verifies successfully (no raise).
            verify_snapshot(
                root, manifest, prefix, runner=bucket.run, tmp_root=verify_dir
            )
        finally:
            # verify_snapshot removes verify_dir itself; clean the parent too.
            parent = DATA_DIR / "work" / "_verify_roundtrip_pbt"
            if parent.exists():
                shutil.rmtree(parent, ignore_errors=True)
