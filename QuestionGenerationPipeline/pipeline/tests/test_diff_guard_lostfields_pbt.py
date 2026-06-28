"""Property-based test for the diff guard's protected-field loss detection.

PROPERTY-BASED TEST (hypothesis, >=100 iterations).

Property 6: The diff guard detects every lost protected field.
For any approved question that carries a non-empty ``imageUrl`` or
``imageDescription`` in the existing handoff but lacks that field in the
prospective handoff, ``diff_guard`` reports a field-loss violation identifying
that question by id and the lost field's change type — and reports no field-loss
violation for any question that did not actually lose a non-empty field.

The generator keeps the SAME ids and the SAME length across ``existing`` and
``prospective`` so that field-loss is isolated from the ``count_drop`` and
``disappeared`` violation kinds (those are covered by Property 5). Assertions
filter violations by ``kind``.

**Validates: Requirements 2.4, 2.5, 2.6**
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from build_handoff import diff_guard


# A protected field can be in one of four states in a handoff entry. Only
# "present" counts as a non-empty value per build_handoff._has_field; "empty"
# and "whitespace" are non-empty keys that still read as absent (they strip to
# ""), and "absent" omits the key entirely.
FIELD_STATES = ["present", "empty", "whitespace", "absent"]

# Non-empty values used when a field is "present". Filtered so the value never
# strips to empty (which would make _has_field treat it as missing).
_nonempty = st.text(
    alphabet=st.characters(min_codepoint=33, max_codepoint=126),
    min_size=1,
    max_size=12,
).filter(lambda s: bool(s.strip()))


@st.composite
def _question_specs(draw):
    """Draw a list of per-question specs.

    Each spec independently chooses the existing/prospective state of both
    protected fields, plus the concrete non-empty values to use when present.
    """
    n = draw(st.integers(min_value=0, max_value=12))
    specs = []
    for _ in range(n):
        specs.append({
            "url_existing": draw(st.sampled_from(FIELD_STATES)),
            "url_prospective": draw(st.sampled_from(FIELD_STATES)),
            "desc_existing": draw(st.sampled_from(FIELD_STATES)),
            "desc_prospective": draw(st.sampled_from(FIELD_STATES)),
            "url_val": draw(_nonempty),
            "desc_val": draw(_nonempty),
        })
    return specs


def _is_present(state: str) -> bool:
    """A field reads as a non-empty value only in the "present" state."""
    return state == "present"


def _apply_field(q: dict, field: str, state: str, value: str) -> None:
    if state == "present":
        q[field] = value
    elif state == "empty":
        q[field] = ""
    elif state == "whitespace":
        q[field] = "   "
    # "absent": leave the key off entirely.


def _build(qid: str, url_state: str, url_val: str, desc_state: str, desc_val: str) -> dict:
    q = {"id": qid}
    _apply_field(q, "imageUrl", url_state, url_val)
    _apply_field(q, "imageDescription", desc_state, desc_val)
    return q


@settings(max_examples=200)
@given(specs=_question_specs())
def test_diff_guard_detects_every_lost_protected_field(specs):
    existing: list[dict] = []
    prospective: list[dict] = []
    expected_url_loss: set[str] = set()
    expected_desc_loss: set[str] = set()

    for i, spec in enumerate(specs):
        qid = f"q-{i:03d}"  # ids are unique and shared between both lists

        existing.append(_build(
            qid, spec["url_existing"], spec["url_val"],
            spec["desc_existing"], spec["desc_val"],
        ))
        # Same id stays in the prospective list (so it never "disappears"); only
        # the protected fields may change state.
        prospective.append(_build(
            qid, spec["url_prospective"], spec["url_val"],
            spec["desc_prospective"], spec["desc_val"],
        ))

        # A loss occurs exactly when the field was a non-empty value in existing
        # and is no longer a non-empty value in prospective.
        if _is_present(spec["url_existing"]) and not _is_present(spec["url_prospective"]):
            expected_url_loss.add(qid)
        if _is_present(spec["desc_existing"]) and not _is_present(spec["desc_prospective"]):
            expected_desc_loss.add(qid)

    violations = diff_guard(existing, prospective)

    url_loss = {v.qid for v in violations if v.kind == "lost_image_url"}
    desc_loss = {v.qid for v in violations if v.kind == "lost_image_description"}

    # Property 6 (Req 2.4): a lost_image_url violation for exactly each question
    # that lost a non-empty imageUrl, identified by id + kind.
    assert url_loss == expected_url_loss

    # Property 6 (Req 2.5): a lost_image_description violation for exactly each
    # question that lost a non-empty imageDescription, identified by id + kind.
    assert desc_loss == expected_desc_loss

    # Req 2.6: each field-loss violation is identified by id + kind, with at most
    # one violation per (id, kind) — no duplicates that would break the by-id map.
    field_kinds = [
        (v.qid, v.kind) for v in violations
        if v.kind in ("lost_image_url", "lost_image_description")
    ]
    assert len(field_kinds) == len(set(field_kinds))

    # Same ids and same length isolate field-loss from count/disappeared kinds.
    assert not any(v.kind in ("count_drop", "disappeared") for v in violations)
