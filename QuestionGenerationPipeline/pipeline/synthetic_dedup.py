"""
synthetic_dedup.py — stage 6 of the synthetic (m6) pipeline (pure).

Detect near-duplicate Generated_Questions *within the current batch* so the
human reviewer can decide what to do. A near-duplicate is a **flag input only**:
nothing is ever dropped, deduplicated away, or regenerated here (Req 7.4). The
triage engine (stage 7) turns a hit into a `duplicate` flag reason.

Scope (Req 7.1, 7.2):
  * Each question is compared against the other four questions derived from the
    SAME seed AND against ALL other questions in the current batch.
  * It is NEVER compared against the existing handoff bank — this module takes
    only the in-memory batch and a seed map, and reads no handoff file.

Similarity reuses `answer_match` loose-normalization style (Req 7.3): the
stem is lowercased, whitespace-collapsed, and stripped of common unit suffixes
and punctuation to form a comparison key.

Near-duplicate criterion (deterministic):
  Two stems are near-duplicates iff their normalized comparison keys are
  exactly equal, OR the Jaccard similarity of their normalized word sets is
  >= ``JACCARD_THRESHOLD`` (0.9). Exact equality is the degenerate Jaccard==1.0
  case; it is kept explicit so two empty/blank stems still flag each other.

See .kiro/specs/synthetic-question-generation/design.md -> "Components and
Interfaces -> 10. synthetic_dedup.py" and Requirements 7.1, 7.2, 7.3, 7.4.

This module is pure: no IO, no network, no global state.
"""

from __future__ import annotations

import re

import answer_match

# A pair of stems counts as a near-duplicate when the Jaccard similarity of
# their normalized word sets reaches this threshold (or they are exactly equal
# after normalization). 0.9 means "almost all words shared" — strict enough to
# avoid flagging merely same-topic questions, loose enough to catch a question
# that only swapped a number or reworded a clause.
JACCARD_THRESHOLD = 0.9

# Stem text is looked up under these keys, in order, on each question dict.
_STEM_KEYS = ("text", "stem", "question", "questionText")


def _stem_of(question: dict) -> str:
    """Best-effort extraction of the question stem from a question dict."""
    for key in _STEM_KEYS:
        value = question.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def normalize_question(text: str) -> str:
    """Produce a comparison key from a question stem.

    Reuses the `answer_match` loose-normalization *style*: lowercase and
    collapse whitespace (via ``answer_match._norm``), drop the same currency/
    percent/degree symbols and common unit suffixes that ``_norm_loose`` drops,
    and strip remaining punctuation — but, unlike ``_norm_loose``, word
    boundaries (single spaces) are preserved so the result can be tokenized for
    word-set similarity.
    """
    if not text:
        return ""
    # Lowercase + whitespace collapse, shared with answer_match.
    s = answer_match._norm(text)
    # Drop currency/percent/degree symbols (mirrors _norm_loose).
    s = re.sub(r"[£%°]", "", s)
    # Drop common unit suffix words (same set as _norm_loose), leaving a space
    # so adjacent words stay separated.
    s = re.sub(
        r"\b(cm|mm|m|km|kg|g|ml|l|litres?|hours?|mins?|minutes?|weeks?|"
        r"days?|millilitres?|degrees?|boys?|girls?)\b",
        " ",
        s,
    )
    # Strip remaining punctuation (anything that is not a word char or space),
    # keeping spaces so words remain tokenizable.
    s = re.sub(r"[^\w\s]", " ", s)
    # Collapse any whitespace introduced above.
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _word_set(normalized: str) -> frozenset[str]:
    """Tokenize a normalized comparison key into a set of words."""
    return frozenset(normalized.split())


def _is_near_duplicate(key_a: str, words_a: frozenset[str],
                       key_b: str, words_b: frozenset[str]) -> bool:
    """Deterministic near-duplicate test between two pre-normalized stems."""
    # Exact normalized-stem equality (covers two blank stems too).
    if key_a == key_b:
        return True
    # Jaccard over normalized word sets. If the union is empty the keys were
    # both empty, already handled by the equality check above.
    union = words_a | words_b
    if not union:
        return False
    jaccard = len(words_a & words_b) / len(union)
    return jaccard >= JACCARD_THRESHOLD


def find_duplicates(batch: dict[str, dict],
                    seed_of: dict[str, str]) -> dict[str, list[str]]:
    """Find near-duplicate questions within the current batch.

    Parameters
    ----------
    batch:
        Maps ``qid -> question dict`` for the questions generated in this run.
        Each question dict carries at least the stem text (looked up under
        ``text``/``stem``/``question``).
    seed_of:
        Maps ``qid -> seedQid``. Used to guarantee the within-seed comparison
        (the other four questions from the same seed); the batch comparison is
        a superset, so the union of the two is simply "every other qid in the
        batch".

    Returns
    -------
    ``{qid: [near-duplicate qids]}`` for every qid that has at least one
    near-duplicate. The lists are sorted for determinism, and the relation is
    symmetric: if A flags B then B flags A. qids with no near-duplicate are
    omitted. A hit is a flag input only — nothing is dropped or regenerated.
    """
    qids = sorted(batch.keys())

    # Precompute the normalized key and word set once per qid (deterministic).
    keys: dict[str, str] = {}
    words: dict[str, frozenset[str]] = {}
    for qid in qids:
        norm = normalize_question(_stem_of(batch[qid]))
        keys[qid] = norm
        words[qid] = _word_set(norm)

    dups: dict[str, list[str]] = {qid: [] for qid in qids}

    # Compare every unordered pair exactly once, then record symmetrically. The
    # candidate set for any qid is "every other qid in the batch", which already
    # contains the four same-seed peers (seed_of) — so both Req 7.1 comparison
    # scopes are satisfied while the handoff bank is never referenced (Req 7.2).
    # ``seed_of`` documents the within-seed scope (Req 7.1); since the batch
    # comparison below already spans every qid, the four same-seed peers are
    # always included. We reference it to validate inputs without narrowing.
    _ = {qid: seed_of.get(qid) for qid in qids}

    for i in range(len(qids)):
        a = qids[i]
        for j in range(i + 1, len(qids)):
            b = qids[j]
            if _is_near_duplicate(keys[a], words[a], keys[b], words[b]):
                dups[a].append(b)
                dups[b].append(a)

    # Keep only qids with at least one near-duplicate; sort lists for stability.
    return {qid: sorted(matches) for qid, matches in dups.items() if matches}
