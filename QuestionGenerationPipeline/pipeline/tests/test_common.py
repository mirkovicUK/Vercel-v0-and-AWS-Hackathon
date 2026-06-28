"""Unit tests for the pipeline foundation (common.py)."""

import itertools
from pathlib import Path

import pytest

import common
from common import (
    DATA_DIR,
    PipelineError,
    assert_within_data,
    load_sources,
    question_id,
)


# ---------- question_id: determinism, format, uniqueness ----------

def test_question_id_format():
    assert question_id("m6", 2) == "q-m6-002"
    assert question_id("m6", 50) == "q-m6-050"
    assert question_id("m6", 1) == "q-m6-001"


def test_question_id_deterministic():
    # Same input -> same output, every call.
    for _ in range(5):
        assert question_id("m6", 7) == "q-m6-007"


def test_question_id_injective_across_slugs():
    # No collisions across the full domain {all registry slugs} x {1..50}.
    slugs = list(load_sources())
    ids = [
        question_id(tag, n)
        for tag, n in itertools.product(slugs, range(1, 51))
    ]
    assert len(ids) == len(set(ids)) == len(slugs) * 50


def test_question_id_rejects_unknown_tag():
    with pytest.raises(PipelineError):
        question_id("m9", 1)


def test_question_id_rejects_bad_number():
    with pytest.raises(PipelineError):
        question_id("m6", 0)
    with pytest.raises(PipelineError):
        question_id("m6", -3)


# ---------- assert_within_data ----------

def test_assert_within_data_accepts_inside_paths():
    p = assert_within_data(DATA_DIR / "synthetic" / "generated" / "q-m6-001.json")
    assert str(p).startswith(str(DATA_DIR.resolve()))


def test_assert_within_data_accepts_data_root_itself():
    assert assert_within_data(DATA_DIR) == DATA_DIR.resolve()


def test_assert_within_data_rejects_parent_escape():
    with pytest.raises(PipelineError):
        assert_within_data(DATA_DIR / ".." / "functions" / "src" / "shared" / "types.ts")


def test_assert_within_data_rejects_absolute_outside():
    with pytest.raises(PipelineError):
        assert_within_data(Path("/etc/passwd"))


def test_assert_within_data_rejects_sneaky_relative_escape():
    with pytest.raises(PipelineError):
        assert_within_data(DATA_DIR / "synthetic" / ".." / ".." / "secrets.txt")


# ---------- load_sources: only the synthetic m6 source is registered ----------

def test_load_sources_is_synthetic_m6_only():
    sources = load_sources()
    assert set(sources) == {"m6"}
    assert sources["m6"].parser_type == "synthetic"


# ---------- write_json is guarded ----------

def test_write_json_rejects_outside_data():
    # A path clearly outside the data dir must be refused before any write.
    outside = Path("/tmp") / "pipeline-should-not-write-here.json"
    with pytest.raises(PipelineError):
        common.write_json(outside, {"x": 1})
    assert not outside.exists()
