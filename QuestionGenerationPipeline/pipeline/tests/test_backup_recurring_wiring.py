"""Unit tests for the recurring backup path and precondition wrapper.

Task 7.1 confirmation (no network, no real bucket):

  * ``backup(full=False)`` snapshots exactly the DURABLE_TREES
    (``sources/``, ``review/``, ``handoff/``) and excludes ``work/`` and
    ``.venv/`` (Req 4.2, 4.3).
  * ``backup(full=False)`` is the on-demand path the default CLI invocation
    uses, and produces a verified snapshot (Req 4.6, 4.9).
  * ``ensure_backup_or_abort()`` runs ``backup(full=False)`` and raises
    ``PipelineError`` on a non-zero result so callers abort (Req 5.1).

The transfer/verify orchestration is exercised against an honest in-memory
fake bucket injected via the ``runner`` hook — the same technique used by the
backup property tests — so nothing touches Cloud Storage.
"""

import json
import subprocess
from pathlib import Path

import pytest

import backup as backup_mod
import common as common_mod
from backup import (
    DURABLE_TREES,
    _MANIFEST_NAME,
    backup,
    ensure_backup_or_abort,
)
from common import PipelineError


def _point_data_dir_at(monkeypatch, root):
    """Redirect every DATA_DIR reference (the module-level globals AND the one
    assert_within_data closes over in common) at a temp tree, so backup()'s
    guarded staging under root/work/ is accepted with no real bucket or real
    data/ involvement."""
    monkeypatch.setattr(backup_mod, "DATA_DIR", root)
    monkeypatch.setattr(backup_mod, "DEFAULT_ROOT", root)
    monkeypatch.setattr(common_mod, "DATA_DIR", root)


class _FakeBucket:
    """Honest in-memory stand-in for the gcloud storage CLI.

    Models exactly the bulk operations backup.py now performs: a single
    ``rsync --recursive`` in each direction between the local filesystem and an
    in-memory object store. Records every uploaded object path so a test can
    assert which trees were captured.
    """

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}
        self.uploads: list[str] = []
        self.calls: list[str] = []

    def run(self, argv: list[str]) -> subprocess.CompletedProcess:
        assert argv[:2] == ["gcloud", "storage"], argv
        op = argv[2]
        self.calls.append(op)
        if op == "rsync":
            args = [a for a in argv[3:] if a != "--recursive"]
            src, dst = args[0], args[1]
            if src.startswith("gs://"):
                # download: store -> local dir
                base = src.rstrip("/") + "/"
                for key, content in list(self.store.items()):
                    if not key.startswith(base):
                        continue
                    rel = key[len(base):]
                    local = Path(dst) / rel
                    local.parent.mkdir(parents=True, exist_ok=True)
                    local.write_bytes(content)
            else:
                # upload: local dir -> store
                base = dst.rstrip("/") + "/"
                srcdir = Path(src)
                for p in srcdir.rglob("*"):
                    if not p.is_file():
                        continue
                    key = base + p.relative_to(srcdir).as_posix()
                    self.store[key] = p.read_bytes()
                    self.uploads.append(key)
            return subprocess.CompletedProcess(argv, 0, "", "")
        return subprocess.CompletedProcess(argv, 1, "", f"unsupported op: {op}")


def _build_tree(root: Path) -> None:
    """A data/-like tree spanning all durable and excluded trees plus a file
    nested in work/ (must be excluded) and one under .venv/ (must be excluded)."""
    files = {
        "sources/m1/booklet.pdf": b"booklet-m1",
        "review/m1-decisions.json": b'{"q-m1-002": "approve"}',
        "handoff/questions.json": b"[]",
        "handoff/figures/q-m1-002.png": b"\x89PNG\r\n",
        "work/draft.json": b"scratch",            # excluded
        ".venv/pyvenv.cfg": b"home = /usr",        # excluded
        "descriptions/drafts/q-m1-002.json": b"{}",  # not durable, not backed up
    }
    for rel, content in files.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(content)


def test_backup_durable_selects_durable_trees_only(tmp_path, monkeypatch):
    """backup(full=False) captures the durable trees and excludes work/ + .venv/.

    Validates: Requirements 4.2, 4.3, 4.6, 4.9
    """
    root = tmp_path / "data"
    _build_tree(root)

    bucket = _FakeBucket()
    _point_data_dir_at(monkeypatch, root)

    rc = backup(full=False, root=root, runner=bucket.run)
    assert rc == 0

    # Reconstruct the relative object paths that were uploaded (minus manifest).
    uploaded_rel = {
        u.split("/data_backup/")[1].split("/", 1)[1]
        for u in bucket.uploads
        if not u.endswith(_MANIFEST_NAME)
    }

    # Every captured file lives under a durable tree...
    assert uploaded_rel == {
        "sources/m1/booklet.pdf",
        "review/m1-decisions.json",
        "handoff/questions.json",
        "handoff/figures/q-m1-002.png",
    }
    # ...and nothing under an excluded tree or a non-durable tree was captured.
    for rel in uploaded_rel:
        assert rel.split("/", 1)[0] in DURABLE_TREES
    assert not any(rel.startswith(("work/", ".venv/", "descriptions/")) for rel in uploaded_rel)

    # The manifest object is present and its fileCount matches the captured set.
    manifest_obj = next(u for u in bucket.uploads if u.endswith(_MANIFEST_NAME))
    manifest = json.loads(bucket.store[manifest_obj])
    assert manifest["fileCount"] == len(uploaded_rel)
    assert manifest["trees"] == list(DURABLE_TREES)

    # Performance contract: the whole backup costs exactly TWO gcloud
    # invocations — one bulk upload and one bulk verify download — regardless
    # of how many files are captured (no longer ~2 per file).
    assert bucket.calls == ["rsync", "rsync"]


def test_ensure_backup_or_abort_passes_on_verified_snapshot(tmp_path, monkeypatch):
    """ensure_backup_or_abort() returns normally when backup(full=False) verifies.

    Validates: Requirement 5.1
    """
    root = tmp_path / "data"
    _build_tree(root)
    bucket = _FakeBucket()
    _point_data_dir_at(monkeypatch, root)

    # Make ensure_backup_or_abort's internal backup(full=False) use the fake
    # runner by patching the module-level backup to inject the runner.
    real_backup = backup_mod.backup

    def _backup_with_fake(full=False, **kwargs):
        kwargs.setdefault("runner", bucket.run)
        return real_backup(full=full, **kwargs)

    monkeypatch.setattr(backup_mod, "backup", _backup_with_fake)

    # Should not raise.
    ensure_backup_or_abort(root=root)


def test_ensure_backup_or_abort_raises_on_failure(monkeypatch):
    """ensure_backup_or_abort() raises PipelineError when backup is non-zero.

    Validates: Requirement 5.1
    """
    monkeypatch.setattr(backup_mod, "backup", lambda *a, **k: 1)
    with pytest.raises(PipelineError, match="backup precondition failed"):
        ensure_backup_or_abort()


def test_ensure_backup_or_abort_invokes_durable_backup(monkeypatch):
    """ensure_backup_or_abort() runs backup with full=False (the durable path)."""
    calls: list[dict] = []

    def _spy(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        return 0

    monkeypatch.setattr(backup_mod, "backup", _spy)
    ensure_backup_or_abort()

    assert len(calls) == 1
    # full=False either positionally or by keyword.
    full = calls[0]["kwargs"].get("full", calls[0]["args"][0] if calls[0]["args"] else False)
    assert full is False
