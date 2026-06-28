"""Property-based test for single-file tamper detection in the backup engine.

PROPERTY-BASED TEST FILE (hypothesis, >=100 iterations).

Property 3: Single-file tamper is always detected and named.
  For any directory tree and any single-file change (flip a byte, truncate,
  delete, or add one file) applied to the uploaded snapshot AFTER the manifest
  is computed, ``verify_snapshot`` fails (raises PipelineError) and the report
  names exactly the affected file/path.

**Validates: Requirements 1.4, 4.7, 6.3**

No network and no real bucket are used: a ``FakeBucket`` models an in-memory
object store and plays the role of the injectable ``gcloud storage`` runner,
handling ``cp`` (both directions) and ``ls --recursive``. Tamper is simulated
by mutating the fake store's contents between upload and verify.
"""

import json
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from common import DATA_DIR, PipelineError
from backup import (
    EXCLUDED_TREES,
    _MANIFEST_NAME,
    _gs_join,
    compute_manifest,
    select_files,
    snapshot_prefix,
    verify_snapshot,
)


# ---------------------------------------------------------------------------
# Fake in-memory bucket — the injectable `runner` (no network, no real CLI).
#
# `_gcloud` calls `runner(argv)` where argv == ["gcloud", "storage", *args].
# verify_snapshot now bulk-downloads the whole snapshot in ONE call, so the
# fake services a single recursive operation:
#   - rsync --recursive gs://PFX <localdir>   (download every object under PFX)
#   - rsync --recursive <localdir> gs://PFX    (upload, for completeness)
# ---------------------------------------------------------------------------

class FakeBucket:
    """Models Cloud Storage as a dict {gs-object-path: bytes}."""

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def runner(self, argv: list[str]) -> subprocess.CompletedProcess:
        # argv[0:2] == ["gcloud", "storage"]; the subcommand follows.
        sub = argv[2]
        if sub == "rsync":
            args = [a for a in argv[3:] if a != "--recursive"]
            src, dst = args[0], args[1]
            if src.startswith("gs://"):
                base = src.rstrip("/") + "/"
                for key, content in list(self.store.items()):
                    if not key.startswith(base):
                        continue
                    local = Path(dst) / key[len(base):]
                    local.parent.mkdir(parents=True, exist_ok=True)
                    local.write_bytes(content)
            else:
                base = dst.rstrip("/") + "/"
                srcdir = Path(src)
                for p in srcdir.rglob("*"):
                    if p.is_file():
                        self.store[base + p.relative_to(srcdir).as_posix()] = (
                            p.read_bytes()
                        )
            return subprocess.CompletedProcess(argv, 0, "", "")
        return subprocess.CompletedProcess(argv, 1, "", f"unsupported: {argv}")


# ---------------------------------------------------------------------------
# Tree generation (mirrors the sibling backup PBTs).
# ---------------------------------------------------------------------------

# Filesystem-safe path segment: letters, digits, underscore, hyphen. No '.', so
# a segment can never be "." / ".." nor the ".venv" excluded tree.
_SEGMENT = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
    min_size=1,
    max_size=8,
)
_REL_PATH = st.lists(_SEGMENT, min_size=1, max_size=4)

# A random tree: (path-segments, content-bytes), content may be empty.
_TREE = st.lists(
    st.tuples(_REL_PATH, st.binary(min_size=0, max_size=600)),
    min_size=0,
    max_size=10,
)

# An anchor file guaranteed to be NON-EMPTY and under a non-excluded tree,
# so byte-flip / truncate tampers always have a valid target.
_ANCHOR = st.tuples(
    st.lists(_SEGMENT, min_size=0, max_size=3),
    st.binary(min_size=1, max_size=600),
)

_TAMPER = st.sampled_from(["flip", "truncate", "delete", "add"])

_NOW = datetime(2025, 1, 1, 0, 0, 0)  # fixed; prefix value is irrelevant here

# A guarded scratch dir inside data/ (work/ is an EXCLUDED_TREE) for verify's
# re-download step, distinct from any sibling test's dir.
_VERIFY_TMP = DATA_DIR / "work" / "_backup_staging" / "_verify_tamper_pbt"


def _materialize(root: Path, entries) -> set[str]:
    """Write generated entries under `root`, skipping path collisions that are
    artifacts of random generation. Returns POSIX-relative paths written."""
    written: set[str] = set()
    for segments, content in entries:
        target = root / Path(*segments)
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
        written.add(target.relative_to(root).as_posix())
    return written


@settings(max_examples=150, deadline=None)
@given(anchor=_ANCHOR, entries=_TREE, tamper=_TAMPER, data=st.data())
def test_single_file_tamper_is_detected_and_named(anchor, entries, tamper, data):
    """Property 3: any single-file tamper applied after the manifest is
    computed is detected by verify_snapshot, and the error names exactly the
    affected file.

    **Validates: Requirements 1.4, 4.7, 6.3**
    """
    root = Path(tempfile.mkdtemp(prefix="backup-tamper-"))
    bucket = FakeBucket()
    try:
        # Anchor lives under a guaranteed non-excluded tree and is non-empty.
        anchor_segments, anchor_content = anchor
        anchor_entry = (["keep_dir", *anchor_segments, "anchor.bin"], anchor_content)
        _materialize(root, [anchor_entry, *entries])

        top_level = tuple(
            sorted(p.name for p in root.iterdir() if p.name not in EXCLUDED_TREES)
        )

        files = select_files(root, top_level)
        manifest = compute_manifest(root, files, trees=top_level, now_utc=_NOW)
        prefix = snapshot_prefix(_NOW)

        # Stage the snapshot directly into the fake bucket (the equivalent of a
        # completed bulk upload): every selected file plus the manifest lands
        # under the snapshot prefix. Tamper is then applied to this store.
        for entry in manifest["files"]:
            rel = entry["path"]
            bucket.store[_gs_join(prefix, rel)] = (root / rel).read_bytes()
        bucket.store[_gs_join(prefix, _MANIFEST_NAME)] = json.dumps(
            manifest
        ).encode("utf-8")

        # Sanity: the untouched snapshot has exactly the manifest's files.
        all_rels = [e["path"] for e in manifest["files"]]
        non_empty_rels = [e["path"] for e in manifest["files"] if e["bytes"] > 0]
        assert all_rels  # anchor guarantees at least one file

        # --- apply exactly ONE change to the snapshot store ----------------
        if tamper == "flip":
            rel = data.draw(st.sampled_from(non_empty_rels))
            key = _gs_join(prefix, rel)
            mutated = bytearray(bucket.store[key])
            mutated[0] ^= 0xFF
            bucket.store[key] = bytes(mutated)
            affected = rel
        elif tamper == "truncate":
            rel = data.draw(st.sampled_from(non_empty_rels))
            key = _gs_join(prefix, rel)
            bucket.store[key] = bucket.store[key][:-1]
            affected = rel
        elif tamper == "delete":
            rel = data.draw(st.sampled_from(all_rels))
            del bucket.store[_gs_join(prefix, rel)]
            affected = rel
        else:  # add an extra object not present in the manifest
            affected = "extra_tamper_file.bin"
            bucket.store[_gs_join(prefix, affected)] = b"unexpected"

        # --- verify must fail and name exactly the affected path -----------
        with pytest.raises(PipelineError) as excinfo:
            verify_snapshot(
                root, manifest, prefix, runner=bucket.runner, tmp_root=_VERIFY_TMP
            )
        assert affected in str(excinfo.value)
    finally:
        import shutil

        shutil.rmtree(root, ignore_errors=True)
        shutil.rmtree(_VERIFY_TMP, ignore_errors=True)
