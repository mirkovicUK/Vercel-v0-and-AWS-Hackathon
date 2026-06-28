"""Unit tests for restore.py — pull + verify round-trip (task 7.2).

No network and no real bucket: a ``FakeBucket`` models an in-memory object
store and plays the role of the injectable ``gcloud storage`` runner, handling
``cp`` in both directions (the same fake shape used by the backup PBTs in
tasks 1.5/1.6). A snapshot is staged into the fake bucket with backup.py's own
upload path, then restored into a guarded temp dir under data/work/.

Covered:
  * happy path — a fully intact snapshot restores and verifies (returns 0).
  * tampered object — a byte-flipped object fails verification, the failing
    file is named, and restore returns non-zero (Req 6.3).
  * missing object — a deleted object fails the restore and is named by path.

Verifies Requirements 6.1, 6.2, 6.3, 6.4.
"""

import json
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

import pytest

from backup import (
    EXCLUDED_TREES,
    _MANIFEST_NAME,
    _gs_join,
    compute_manifest,
    select_files,
    snapshot_prefix,
)
from common import DATA_DIR, PipelineError
import restore as restore_mod
from restore import restore, restore_prefix


# ---------------------------------------------------------------------------
# Fake in-memory bucket — the injectable `runner` (no network, no real CLI).
# Mirrors the FakeBucket used by the backup property tests.
# ---------------------------------------------------------------------------

class FakeBucket:
    """Models Cloud Storage as a dict {gs-object-path: bytes}."""

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def runner(self, argv: list[str]) -> subprocess.CompletedProcess:
        assert argv[:2] == ["gcloud", "storage"], argv
        sub = argv[2]
        if sub == "rsync":
            # restore bulk-downloads (gs->local) in ONE call; upload supported
            # too for completeness.
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


_NOW = datetime(2025, 2, 14, 9, 15, 0)
_TIMESTAMP = f"{_NOW:%Y%m%dT%H%M%SZ}"


def _stage_snapshot(bucket: FakeBucket, source_root: Path):
    """Build a manifest for `source_root` and stage it + its files directly
    into the fake bucket under the snapshot prefix (the equivalent of a
    completed bulk upload). Returns (manifest, prefix)."""
    top_level = tuple(
        sorted(p.name for p in source_root.iterdir() if p.name not in EXCLUDED_TREES)
    )
    files = select_files(source_root, top_level)
    manifest = compute_manifest(source_root, files, trees=top_level, now_utc=_NOW)
    prefix = snapshot_prefix(_NOW)

    for entry in manifest["files"]:
        rel = entry["path"]
        bucket.store[_gs_join(prefix, rel)] = (source_root / rel).read_bytes()
    bucket.store[_gs_join(prefix, _MANIFEST_NAME)] = json.dumps(manifest).encode(
        "utf-8"
    )
    return manifest, prefix


def _make_source_tree(root: Path) -> None:
    """A small, representative durable tree: nested dirs, an empty file, and
    binary content."""
    (root / "handoff").mkdir(parents=True)
    (root / "handoff" / "questions.json").write_text(
        json.dumps([{"id": "q-m1-002"}]), encoding="utf-8"
    )
    (root / "handoff" / "figures").mkdir()
    (root / "handoff" / "figures" / "q-m1-002.png").write_bytes(bytes(range(256)))
    (root / "review").mkdir()
    (root / "review" / "m1-decisions.json").write_text("{}", encoding="utf-8")
    (root / "sources").mkdir()
    (root / "sources" / "empty.txt").write_bytes(b"")  # empty-file edge case


def test_restore_prefix_matches_backup_format():
    """restore_prefix mirrors backup.snapshot_prefix for the same stamp."""
    assert restore_prefix(_TIMESTAMP) == snapshot_prefix(_NOW)


def test_happy_path_restore_verifies(tmp_path):
    """A fully intact snapshot restores and verifies, returning 0 (Req 6.1, 6.2)."""
    source_root = tmp_path / "src"
    source_root.mkdir()
    _make_source_tree(source_root)

    bucket = FakeBucket()
    manifest, _ = _stage_snapshot(bucket, source_root)

    dest = DATA_DIR / "work" / "_restore_test" / uuid.uuid4().hex
    try:
        rc = restore(_TIMESTAMP, dest, runner=bucket.runner)
        assert rc == 0

        # Every manifest file is present in dest with identical bytes.
        for entry in manifest["files"]:
            restored = dest / entry["path"]
            original = source_root / entry["path"]
            assert restored.is_file()
            assert restored.read_bytes() == original.read_bytes()
    finally:
        shutil.rmtree(DATA_DIR / "work" / "_restore_test", ignore_errors=True)


def test_tampered_object_fails_and_is_named(tmp_path):
    """A byte-flipped object fails verification; restore returns non-zero and
    the failing file is named (Req 6.3)."""
    source_root = tmp_path / "src"
    source_root.mkdir()
    _make_source_tree(source_root)

    bucket = FakeBucket()
    manifest, prefix = _stage_snapshot(bucket, source_root)

    # Tamper with one non-empty object in the bucket after upload.
    target_rel = "handoff/figures/q-m1-002.png"
    key = _gs_join(prefix, target_rel)
    mutated = bytearray(bucket.store[key])
    mutated[0] ^= 0xFF
    bucket.store[key] = bytes(mutated)

    dest = DATA_DIR / "work" / "_restore_test" / uuid.uuid4().hex
    captured: list[str] = []
    try:
        # Capture stderr output to assert the failing file is named.
        import io
        import contextlib

        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = restore(_TIMESTAMP, dest, runner=bucket.runner)
        captured.append(buf.getvalue())

        assert rc != 0
        assert target_rel in captured[0]
    finally:
        shutil.rmtree(DATA_DIR / "work" / "_restore_test", ignore_errors=True)


def test_missing_object_fails_and_is_named(tmp_path):
    """A deleted object fails the restore and is named by path (Req 6.3)."""
    source_root = tmp_path / "src"
    source_root.mkdir()
    _make_source_tree(source_root)

    bucket = FakeBucket()
    manifest, prefix = _stage_snapshot(bucket, source_root)

    target_rel = "review/m1-decisions.json"
    del bucket.store[_gs_join(prefix, target_rel)]

    dest = DATA_DIR / "work" / "_restore_test" / uuid.uuid4().hex
    try:
        import io
        import contextlib

        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = restore(_TIMESTAMP, dest, runner=bucket.runner)
        out = buf.getvalue()

        assert rc != 0
        assert target_rel in out
    finally:
        shutil.rmtree(DATA_DIR / "work" / "_restore_test", ignore_errors=True)


def test_dest_escaping_data_raises(tmp_path):
    """A destination outside data/ is refused by the Data_Guard (Req 6.4)."""
    bucket = FakeBucket()
    # Point dest somewhere clearly outside data/.
    outside = tmp_path / "outside_data"
    rc = restore(_TIMESTAMP, outside, runner=bucket.runner)
    # restore catches the PipelineError from assert_within_data and returns 1.
    assert rc == 1
