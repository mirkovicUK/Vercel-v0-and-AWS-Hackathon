"""Unit tests for the diff guard's description-source asymmetry (Req 2.9).

The product places `imageDescription` ONLY in the handoff family of files
(`handoff/questions.json`, `descriptions/drafts/`, `handoff/descriptions.json`)
— it is deliberately absent from every `review/<tag>-decisions.json`. The diff
guard must honour that asymmetry: it decides whether a description was *lost* by
reading presence from the EXISTING handoff list only, and it never reaches for,
or requires, a description in any decisions file.

These tests prove the asymmetry *by construction*: `diff_guard` is a pure
function of two question lists (`existing`, `prospective`). It has no parameter
for, and no way to read, a `review/<tag>-decisions.json` file. Whatever a
decisions file might contain is therefore irrelevant to this check — the only
thing that can trigger a `lost_image_description` violation is a description
that was present in `existing` and is gone from `prospective`.

**Validates: Requirements 2.9**
"""

from build_handoff import diff_guard


def test_lost_description_is_detected_from_existing_handoff_only():
    """existing carries a description; prospective keeps the id + imageUrl but
    drops the imageDescription -> exactly one `lost_image_description`.

    Note there is NO decisions argument anywhere in this call. The description's
    presence is read purely from `existing`, never from any
    `review/<tag>-decisions.json` (which by product invariant never holds it)."""
    existing = [
        {
            "id": "q-m1-001",
            "text": "What shape is shown?",
            "imageUrl": "figures/q-m1-001.png",
            "imageDescription": "a right-angled triangle",
        }
    ]
    # Same id, figure retained, description dropped — the destructive change.
    prospective = [
        {
            "id": "q-m1-001",
            "text": "What shape is shown?",
            "imageUrl": "figures/q-m1-001.png",
        }
    ]

    violations = diff_guard(existing, prospective)

    lost_desc = [v for v in violations if v.kind == "lost_image_description"]
    assert len(lost_desc) == 1
    assert lost_desc[0].qid == "q-m1-001"
    # The figure was retained, so no imageUrl loss is reported.
    assert not [v for v in violations if v.kind == "lost_image_url"]


def test_no_description_in_existing_means_absence_is_not_a_violation():
    """The inverse: when `existing` has NO description, `prospective` not having
    one is NOT a loss — regardless of what any decisions file might say.

    A `review/<tag>-decisions.json` never carries `imageDescription`, so if the
    guard required it from decisions this question would falsely look "lost".
    Because the guard reads presence from the existing handoff only, and the
    existing handoff has no description here, there is nothing to lose."""
    existing = [
        {
            "id": "q-m1-002",
            "text": "Compute 2 + 2.",
            # deliberately no imageDescription — mirrors a decisions-sourced
            # question that never had one in the handoff either
        }
    ]
    prospective = [
        {
            "id": "q-m1-002",
            "text": "Compute 2 + 2.",
        }
    ]

    violations = diff_guard(existing, prospective)

    assert not [v for v in violations if v.kind == "lost_image_description"]


def test_decisions_content_is_structurally_irrelevant_to_the_check():
    """diff_guard's signature is (existing, prospective) only.

    This asserts the asymmetry at the API level: there is no third argument by
    which a `review/<tag>-decisions.json` could influence description handling.
    We simulate a "decisions" payload that lacks any imageDescription (the real
    product invariant) and confirm it plays no part — only `existing` decides.

    Case A: existing HAS a description -> lost when prospective drops it.
    Case B: existing LACKS a description -> not lost, even though the parallel
            decisions payload (which never carries descriptions) is identical.
    The two outcomes differ solely because `existing` differs, proving the
    decisions side is irrelevant by construction."""
    # A stand-in for a decisions file: note it has no imageDescription field,
    # exactly as real review/<tag>-decisions.json never does. It is NOT passed
    # to diff_guard — there is nowhere to pass it — which is the whole point.
    decisions_like = {"id": "q-m1-003", "decision": "approve",
                      "imageUrl": "figures/q-m1-003.png"}
    assert "imageDescription" not in decisions_like

    # Case A: description present in existing handoff -> its removal is a loss.
    existing_a = [{
        "id": "q-m1-003",
        "text": "Read the bar chart.",
        "imageUrl": "figures/q-m1-003.png",
        "imageDescription": "a bar chart with three bars",
    }]
    prospective_a = [{
        "id": "q-m1-003",
        "text": "Read the bar chart.",
        "imageUrl": "figures/q-m1-003.png",
    }]
    violations_a = diff_guard(existing_a, prospective_a)
    assert [v.qid for v in violations_a if v.kind == "lost_image_description"] == ["q-m1-003"]

    # Case B: same id and same (description-free) decisions payload, but the
    # existing handoff never carried a description -> no loss reported.
    existing_b = [{
        "id": "q-m1-003",
        "text": "Read the bar chart.",
        "imageUrl": "figures/q-m1-003.png",
    }]
    prospective_b = [{
        "id": "q-m1-003",
        "text": "Read the bar chart.",
        "imageUrl": "figures/q-m1-003.png",
    }]
    violations_b = diff_guard(existing_b, prospective_b)
    assert not [v for v in violations_b if v.kind == "lost_image_description"]
