"""Property-based test for the diff guard's disappeared-question detection.

PROPERTY-BASED TEST (hypothesis, >=100 iterations).

Property 5: The diff guard detects every disappeared approved question.
For any existing handoff and any prospective handoff that omits one or more
approved identifiers (and therefore has a lower or equal count), the diff guard
reports a violation for exactly each omitted identifier, each tagged with its
change type ("disappeared"). A "count_drop" violation (qid="*") may also be
present when the count drops; the disappeared id set is checked by filtering to
kind == "disappeared".

**Validates: Requirements 2.2, 2.3, 2.6**
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from build_handoff import diff_guard


@st.composite
def existing_and_prospective(draw):
    """Generate an (existing, prospective, omitted_ids) triple.

    ``existing`` is a list of unique-id question dicts (some carrying imageUrl
    and/or imageDescription, some bare). ``prospective`` is ``existing`` with a
    non-empty subset of ids omitted, optionally topped up with brand-new
    (never-before-seen) ids so the total count is lower than OR equal to the
    existing count — but never higher. ``omitted_ids`` is the exact set of
    existing ids dropped from prospective.
    """
    n = draw(st.integers(min_value=1, max_value=15))

    # Unique existing ids rendered as q-<int>.
    int_ids = draw(st.lists(
        st.integers(min_value=0, max_value=100_000),
        min_size=n, max_size=n, unique=True,
    ))

    existing: list[dict] = []
    for i in int_ids:
        q: dict = {"id": f"q-{i}", "text": f"question {i}"}
        if draw(st.booleans()):
            q["imageUrl"] = f"figures/q-{i}.png"
        if draw(st.booleans()):
            q["imageDescription"] = f"a description for {i}"
        existing.append(q)

    # Pick which existing questions to omit; force at least one omission so the
    # property's precondition (one or more disappeared) always holds.
    omit_flags = draw(st.lists(st.booleans(), min_size=n, max_size=n))
    if not any(omit_flags):
        omit_flags[draw(st.integers(min_value=0, max_value=n - 1))] = True

    kept = [q for q, drop in zip(existing, omit_flags) if not drop]
    omitted_ids = {q["id"] for q, drop in zip(existing, omit_flags) if drop}

    # Optionally add brand-new questions (ids disjoint from existing). Capping
    # the add count at the number omitted keeps len(prospective) <= len(existing).
    add_count = draw(st.integers(min_value=0, max_value=len(omitted_ids)))
    new_questions = [{"id": f"new-{j}", "text": f"new question {j}"}
                     for j in range(add_count)]

    prospective = kept + new_questions

    # Order must not matter to the guard; shuffle to prove it.
    prospective = draw(st.permutations(prospective))

    return existing, list(prospective), omitted_ids


@settings(max_examples=200)
@given(data=existing_and_prospective())
def test_diff_guard_detects_every_disappeared_question(data):
    existing, prospective, omitted_ids = data

    # Sanity: the construction yields a lower-or-equal count (never higher).
    assert len(prospective) <= len(existing)

    violations = diff_guard(existing, prospective)

    # Property 5 core: exactly each omitted id is reported as "disappeared".
    disappeared = {v.qid for v in violations if v.kind == "disappeared"}
    assert disappeared == omitted_ids

    # Every disappeared violation is tagged with the "disappeared" change type
    # and names a real omitted id (Req 2.2, 2.6).
    for v in violations:
        if v.kind == "disappeared":
            assert v.qid in omitted_ids
        # The count-drop headline (Req 2.3) is always anchored to the wildcard id.
        if v.kind == "count_drop":
            assert v.qid == "*"

    # Req 2.3: whenever the prospective count is strictly lower, the guard emits
    # exactly one count_drop violation tagged with qid="*".
    count_drops = [v for v in violations if v.kind == "count_drop"]
    if len(prospective) < len(existing):
        assert len(count_drops) == 1
        assert count_drops[0].qid == "*"
    else:
        assert count_drops == []
