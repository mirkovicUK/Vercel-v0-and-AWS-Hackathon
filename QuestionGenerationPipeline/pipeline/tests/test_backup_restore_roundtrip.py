"""Mandatory test-restore integration test — backup -> restore round-trip (task 7.6).

This is the end-to-end proof of Req 6.5: the backup tooling is exercised by
performing one real round-trip at the code level — a snapshot is *created and
verified* by ``backup(full=False)`` and then *pulled back and verified* by
``restore()`` — and the restored tree is asserted content-identical to the
source durable trees.

It is repeatable and network-free. A single in-memory ``FakeBucket`` is shared
between the backup and the restore so an object uploaded by ``backup()`` is the
very object pulled by ``restore()`` (no real Cloud Storage, no ``gcloud`` CLI).
The fake plays the injectable ``runner`` role for both modules.

Key constraints honoured here:
  * the snapshot timestamp is shared between backup and restore by injecting a
    fixed ``now_utc`` into ``backup``, so the prefix/timestamp to restore is
    known up front;
  * every guarded write (backup's staging/verify temp dirs and the restore
    destination) stays within ``data/`` — the source tree and the restore dest
    both live under a unique, cleaned-up temp dir beneath ``data/work/`` so
    ``assert_within_data`` accepts them with the real ``DATA_DIR``;
  * the real bucket is never touched.

Validates: Requirements 6.5 (and exercises 6.1, 6.2, 4.2, 4.3, 4.6 end-to-end).
"""

import json
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

import pytest

from backup import backup, snapshot_prefix
from common import DATA_DIR, assert_within_data
from restore import restore


# ---------------------------------------------------------------------------
# Shared in-memory fake bucket — the injectable `runner` for BOTH backup and
# restore. Models Cloud Storage as a dict {gs-object-path: bytes} and handles
# exactly the bulk operation the tooling now performs: a single
# `rsync --recursive` between the local filesystem and the store, in either
# direction. Because the same instance is passed to backup() and restore(), an
# object uploaded during backup is pulled during restore.
# ---------------------------------------------------------------------------

class FakeBucket:
    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def runner(self, argv: list[str]) -> subprocess.CompletedProcess:
        assert argv[:2] == ["gcloud", "storage"], argv
        op = argv[2]
        if op == "rsync":
            # backup uploads (local->gs) and verify/restore download (gs->local)
            # all via `rsync --recursive SRC DST`.
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
        return subprocess.CompletedProcess(argv, 1, "", f"unsupported op: {op}")


# A fixed UTC instant so backup and restore agree on the snapshot prefix.
_NOW = datetime(2025, 2, 14, 9, 15, 0)
_TIMESTAMP = f"{_NOW:%Y%m%dT%H%M%SZ}"


def _build_durable_source(root: Path) -> dict[str, bytes]:
    """Create a representative durable-tree source under `root` spanning the
    three durable trees with nested dirs, an empty file, and binary content.

    Returns {relative-posix-path: bytes} for every durable file, for the
    content-identical comparison after restore.
    """
    files: dict[str, bytes] = {
        # handoff/ — deliverable: JSON + a nested figures dir with binary bytes
        "handoff/questions.json": json.dumps(
            [{"id": "q-m1-002"}, {"id": "q-m5-014"}]
        ).encode("utf-8"),
        "handoff/descriptions.json": b"{}",
        "handoff/figures/q-m1-002.png": bytes(range(256)),          # binary
        "handoff/figures/nested/q-m5-014.png": bytes(range(255, -1, -1)),  # nested + binary
        # review/ — decisions
        "review/m1-decisions.json": b'{"q-m1-002": "approve"}',
        "review/descriptions-decisions.json": b"{}",
        # sources/ — per-source inputs, plus an empty-file edge case
        "sources/m1/booklet.pdf": b"%PDF-1.4\n booklet m1 bytes",
        "sources/m5/answers.pdf": b"%PDF-1.4\n answers m5 bytes",
        "sources/empty.txt": b"",                                    # empty file
    }
    for rel, content in files.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(content)
    return files


def _read_tree(root: Path, *, exclude: set[str]) -> dict[str, bytes]:
    """Map every file under `root` to its bytes by POSIX-relative path,
    skipping any top-level-relative path in `exclude`."""
    out: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel in exclude:
            continue
        out[rel] = path.read_bytes()
    return out


def test_backup_restore_roundtrip_is_content_identical():
    """Back up the durable trees and restore them through one shared fake
    bucket; the restored tree verifies against the manifest (restore returns 0)
    and is content-identical to the source durable trees.

    Validates: Requirement 6.5
    """
    # A single guarded workspace beneath data/work/ holds both the source tree
    # and the restore destination, so every guarded write (backup staging +
    # restore dest) resolves inside data/ under the real DATA_DIR.
    work_base = assert_within_data(
        DATA_DIR / "work" / "_roundtrip_test" / uuid.uuid4().hex
    )
    source_root = work_base / "src"
    dest = work_base / "dest"

    bucket = FakeBucket()
    try:
        source_root.mkdir(parents=True)
        source_files = _build_durable_source(source_root)

        # --- backup: create + verify a snapshot in the shared fake bucket. ---
        rc_backup = backup(
            full=False,
            root=source_root,
            now_utc=_NOW,          # fixed stamp => known prefix/timestamp
            runner=bucket.runner,
        )
        assert rc_backup == 0, "backup() should create and verify the snapshot"

        # The snapshot really landed in the bucket under the expected prefix.
        prefix = snapshot_prefix(_NOW)
        assert any(k.startswith(prefix) for k in bucket.store)

        # --- restore: pull the SAME snapshot back and verify it. ---
        rc_restore = restore(_TIMESTAMP, dest, runner=bucket.runner)
        assert rc_restore == 0, "restore() should verify against the manifest"

        # --- round-trip proof: restored tree == source durable trees. ---
        # The restore writes manifest.json into dest as well; it is not part of
        # the source durable set, so exclude it from the comparison.
        restored = _read_tree(dest, exclude={"manifest.json"})

        # Same set of relative paths...
        assert set(restored) == set(source_files)
        # ...and identical bytes for every file (covers empty + binary + nested).
        for rel, content in source_files.items():
            assert restored[rel] == content, f"content drift for {rel}"
    finally:
        shutil.rmtree(work_base, ignore_errors=True)


def test_roundtrip_is_repeatable():
    """The round-trip is deterministic and network-free, so a second run with a
    fresh bucket and workspace succeeds identically (CI-safe repeatability)."""
    for _ in range(2):
        work_base = assert_within_data(
            DATA_DIR / "work" / "_roundtrip_test" / uuid.uuid4().hex
        )
        source_root = work_base / "src"
        dest = work_base / "dest"
        bucket = FakeBucket()
        try:
            source_root.mkdir(parents=True)
            source_files = _build_durable_source(source_root)

            assert backup(
                full=False, root=source_root, now_utc=_NOW, runner=bucket.runner
            ) == 0
            assert restore(_TIMESTAMP, dest, runner=bucket.runner) == 0

            restored = _read_tree(dest, exclude={"manifest.json"})
            assert set(restored) == set(source_files)
            for rel, content in source_files.items():
                assert restored[rel] == content
        finally:
            shutil.rmtree(work_base, ignore_errors=True)
