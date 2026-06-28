"""
restore.py — pull + verify a snapshot produced by backup.py.

The Restore_Tool pulls a chosen snapshot back from the private backup bucket
to a local destination and verifies every restored file against the snapshot's
manifest before reporting success. It is the round-trip counterpart of
backup.py and shares that module's conventions: the `gcloud storage` CLI moves
the bytes, every SHA-256 digest is recomputed in Python, and the `runner` hook
is injectable so the whole pull+verify flow can be exercised with an in-memory
fake bucket (no network, no real bucket).

Flow (bulk-transfer based, mirroring backup.py):
  1. Build the snapshot prefix from BUCKET + the chosen timestamp and perform
     ONE recursive download of the whole snapshot into `dest`, with `dest`
     routed through `assert_within_data` so nothing escapes data/ (Req 6.4).
  2. Read the restored `manifest.json`.
  3. Recompute the SHA-256 of each restored file in Python and compare it to
     the manifest (Req 6.2). Any missing file or digest mismatch is reported by
     name and makes the restore return non-zero (Req 6.3).
  4. Return 0 only on a fully verified restore.

See .kiro/specs/question-bank-backup-hardening/design.md ->
"Components and Interfaces -> 5. restore.py — pull + verify".
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import PipelineError, assert_within_data, read_json

# Reuse backup.py's conventions and CLI plumbing rather than re-implementing
# them: the bucket constant, manifest filename, the bulk download helper, and
# the streamed SHA-256.
from backup import (
    BUCKET,
    _MANIFEST_NAME,
    _bulk_download,
    _sha256_streamed,
)


def restore_prefix(timestamp: str) -> str:
    """Return the snapshot prefix for `timestamp` (mirrors backup.snapshot_prefix):

        gs://<bucket>/data_backup/<timestamp>/

    `timestamp` is the snapshot's UTC stamp as it appears in the bucket path,
    e.g. ``20250214T091500Z``.
    """
    return f"{BUCKET}/data_backup/{timestamp}/"


def restore(timestamp: str, dest: Path | str, *, runner=None) -> int:
    """Pull the snapshot at `timestamp` to `dest` and verify it; return an exit
    code (0 = fully verified, non-zero = a file was missing or failed digest
    verification).

    Bulk-transfer based, mirroring backup.py — ~1 gcloud invocation instead of
    one per file:
      1. ONE recursive download of the whole snapshot into `dest`, with `dest`
         guarded by assert_within_data (Req 6.4).
      2. read the restored manifest.json.
      3. recompute each restored file's SHA-256 in Python and compare it to the
         manifest (Req 6.2). Every write/read target under dest is routed
         through assert_within_data so nothing escapes data/.
      4. report EVERY failing file (missing or digest mismatch) in one pass so
         the operator sees the full blast radius, and return non-zero if any
         failed (Req 6.3). Return 0 only when every file verifies.
    """
    prefix = restore_prefix(timestamp)
    try:
        dest_path = assert_within_data(dest)
        dest_path.mkdir(parents=True, exist_ok=True)

        # 1. ONE bulk download of the entire snapshot into dest.
        _bulk_download(prefix, dest_path, runner=runner)

        # 2. The manifest drives verification; it must have come down.
        manifest_local = assert_within_data(dest_path / _MANIFEST_NAME)
        if not manifest_local.is_file():
            raise PipelineError(
                f"snapshot manifest missing after restore: {_MANIFEST_NAME} "
                f"not found under {prefix}"
            )
        manifest = read_json(manifest_local)
        entries = manifest.get("files", [])

        print(
            f"[restore] pulled {len(entries)} file(s) from {prefix} -> {dest_path}",
            file=sys.stderr,
        )

        # 3 + 4. Verify each file locally, collecting every failure rather than
        # stopping at the first, so the report names them all.
        failures: list[tuple[str, str]] = []
        for entry in entries:
            rel = entry["path"]
            want_sha = entry["sha256"]

            local = assert_within_data(dest_path / rel)
            if not local.is_file():
                failures.append((rel, "missing after restore"))
                continue

            got_sha, _ = _sha256_streamed(local)
            if got_sha != want_sha:
                failures.append(
                    (
                        rel,
                        f"digest mismatch (manifest {want_sha[:12]}…, "
                        f"restored {got_sha[:12]}…)",
                    )
                )

        if failures:
            for rel, reason in failures:
                print(f"[restore] FAILED {rel}: {reason}", file=sys.stderr)
            print(
                f"[restore] {len(failures)} of {len(entries)} file(s) failed "
                f"verification",
                file=sys.stderr,
            )
            return 1
    except PipelineError as exc:
        print(f"[restore] {exc}", file=sys.stderr)
        return 1

    print(
        f"[restore] verified {len(entries)} file(s) from {prefix} into {dest_path}",
        file=sys.stderr,
    )
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="restore.py",
        description=(
            "Pull a snapshot from the private backup bucket to a local "
            "destination (within data/) and verify every restored file against "
            "the snapshot's manifest."
        ),
    )
    parser.add_argument(
        "timestamp",
        help="snapshot UTC timestamp as it appears in the bucket path, "
             "e.g. 20250214T091500Z",
    )
    parser.add_argument(
        "dest",
        help="local destination directory; must resolve within data/",
    )
    args = parser.parse_args(argv[1:])
    return restore(args.timestamp, Path(args.dest))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
