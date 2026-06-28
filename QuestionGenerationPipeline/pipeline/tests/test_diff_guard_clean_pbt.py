"""Property-based test for the diff guard clean-pass case.

PROPERTY-BASED TEST (hypothesis, >=100 iterations).

Property 7: The diff guard passes cleanly when nothing is removed.
For any prospective handoff that preserves every existing approved identifier
together with its ``imageUrl`` and ``imageDescription`` (and does not lower the
count), the diff guard reports no violations and the overwrite is permitted.

The prospective handoff may ADD new questions and may add fields, but never
removes an id or drops a protected field.

**Validates: Requirements 2.1, 2.8**
"""

import copy

from hypothesis import given, settings
from hypothesis import strategies as st

from build_handoff import diff_guard


TOPICS = [
    "number", "fractions_decimals_percentages", "ratio_proportion",
    "algebra", "geometry", "data_handling",
]

# Non-empty values so that, when present, _has_field treats them as protected.
_image_url = st.text(min_size=1, max_size=12).map(lambda s: f"https://x/{s}.png")
_image_desc = st.text(min_size=1, max_size=24)


def _question(qid: str) -> st.SearchStrategy:
    """A varied question dict: always an id, sometimes a non-empty imageUrl
    and/or imageDescription, plus a few ordinary content fields."""
    base = st.fixed_dictionaries({
        "id": st.just(qid),
        "text": st.text(min_size=1, max_size=20),
        "topic": st.sampled_from(TOPICS),
        "difficulty": st.integers(min_value=1, max_value=5),
        "correctIndex": st.integers(min_value=0, max_value=3),
    })
    # Optionally attach the protected fields (some with, some without).
    optionals = st.fixed_dictionaries(
        {},
        optional={"imageUrl": _image_url, "imageDescription": _image_desc},
    )
    return st.builds(lambda b, o: {**b, **o}, base, optionals)


@st.composite
def existing_and_prospective(draw):
    """Generate an `existing` list of distinct-id questions and a `prospective`
    list that preserves every id with its protected fields, may add fields, and
    may append brand-new questions (never lowering the count or dropping a
    protected field)."""
    ids = draw(st.lists(
        st.from_regex(r"q-m[1-5]-[0-9]{3}", fullmatch=True),
        min_size=0, max_size=8, unique=True,
    ))
    existing = [draw(_question(qid)) for qid in ids]

    # Prospective starts as a faithful, deep copy: every id and every protected
    # field value is preserved exactly.
    prospective = copy.deepcopy(existing)

    # Optionally add non-protected fields to some preserved questions.
    for q in prospective:
        if draw(st.booleans()):
            q["explanation"] = draw(st.text(max_size=10))

    # Optionally append brand-new questions with fresh, non-colliding ids.
    n_new = draw(st.integers(min_value=0, max_value=4))
    for i in range(n_new):
        new_id = f"q-new-{i:03d}"
        prospective.append(draw(_question(new_id)))

    # Order must not matter to the guard; shuffle the prospective list.
    prospective = draw(st.permutations(prospective))

    return existing, prospective


@settings(max_examples=200)
@given(existing_and_prospective())
def test_diff_guard_passes_cleanly_when_nothing_removed(pair):
    existing, prospective = pair
    violations = diff_guard(existing, prospective)
    assert violations == [], (
        f"expected no violations for a non-destructive change, got {violations}"
    )
