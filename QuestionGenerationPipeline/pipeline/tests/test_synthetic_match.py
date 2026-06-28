"""Unit tests for the two 5-seed dry-run quality fixes (no real network).

Covers:
  - ISSUE 2: synthetic_match.match_inspector_answer is robust to a leading
    option-letter prefix ("B) £23,460", "C. 800", "(A)", bare "B") while a
    free-text answer ("Bananas") is NOT misread as an option letter, and a
    plain numeric answer still resolves via the existing answer_match tiers.
  - ISSUE 1: bedrock_text_client.GENERATOR_MAX_TOKENS was raised to 3500 so a
    difficulty 4-5 worked solution no longer truncates at 1500.

These modules are pure / config-only, so no Bedrock client is touched.
"""

import bedrock_text_client
from synthetic_match import match_inspector_answer

# A representative money option list (the dry-run "answer_mismatch" example).
MONEY_OPTIONS = ["£23,046", "£23,460", "£23,406", "£2,346", "£230,460"]
NUM_OPTIONS = ["8", "80", "800", "8000", "8032"]


# --- ISSUE 2: letter-prefixed inspector answers ---------------------------

def test_letter_paren_prefix_with_money_text():
    # "B) £23,460" must resolve to option index 1 (the inspector agreed).
    assert match_inspector_answer("B) £23,460", MONEY_OPTIONS) == 1


def test_letter_paren_prefix_with_number_text():
    assert match_inspector_answer("C) 800", NUM_OPTIONS) == 2


def test_paren_wrapped_bare_letter():
    assert match_inspector_answer("(A)", MONEY_OPTIONS) == 0


def test_bare_letter():
    assert match_inspector_answer("B", MONEY_OPTIONS) == 1


def test_dot_and_other_delimiters():
    assert match_inspector_answer("C. 800", NUM_OPTIONS) == 2
    assert match_inspector_answer("D - 8000", NUM_OPTIONS) == 3
    assert match_inspector_answer("E: 8032", NUM_OPTIONS) == 4


def test_free_text_not_read_as_option_letter():
    # "Bananas" starts with 'B' but is free text: it must NOT resolve to option
    # B. With no option literally matching, it falls back to None.
    assert match_inspector_answer("Bananas", MONEY_OPTIONS) is None


def test_free_text_letter_word_resolves_only_by_exact_match():
    # If an option literally equals the free text, the fallback tier matches it.
    opts = ["Apple", "Banana", "Cherry"]
    assert match_inspector_answer("Banana", opts) == 1


def test_plain_numeric_answer_still_resolves_via_existing_tiers():
    # A normal numeric answer has no letter prefix; existing numeric/exact tiers
    # resolve it. "12" matches the option "12".
    assert match_inspector_answer("12", ["10", "11", "12", "13", "14"]) == 2


def test_letter_index_out_of_range_falls_back():
    # "E) something" -> index 4, but only 3 options: out of range -> fall back,
    # and with no matching option, returns None rather than a bogus index.
    assert match_inspector_answer("E) zzz", ["a", "b", "c"]) is None


def test_no_unique_match_returns_none():
    assert match_inspector_answer("nope", MONEY_OPTIONS) is None


# --- ISSUE 1: generator max tokens -----------------------------------------

def test_generator_max_tokens_raised_to_3500():
    assert bedrock_text_client.GENERATOR_MAX_TOKENS == 3500
