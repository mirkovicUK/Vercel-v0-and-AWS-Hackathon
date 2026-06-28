# Question Generation Pipeline — the question bank behind ApexMaths

An offline, adversarial, human-gated factory that turns a small bank of
human-vetted 11+ maths questions into a much larger one — without lowering the
bar on correctness.

> **Context.** This pipeline is part of **ApexMaths**, the H0 hackathon submission
> (a UK 11+ maths practice product: Next.js on **Vercel**, **Amazon Aurora
> Postgres** via the RDS Data API, Cognito, Bedrock, Stripe). The live app is a
> thin client over a server-authoritative core — and the one thing it can never
> do is *invent* the questions children practise on. Those questions live in the
> Aurora `questions` table, and **this pipeline is how that table gets filled
> with content we trust.** It runs on a laptop, not in production; its only output
> is a JSON file the app's seed step loads into Aurora.

---

## Why this exists

ApexMaths grades server-side and never ships an answer key to the browser. That
design only means something if the answer key is actually *right*. 11+
multiple-choice options are deliberately close together — a question with a
wrong "correct" answer, or two defensible answers, isn't a cosmetic bug; it
teaches a child the wrong thing and corrupts the mastery analytics that drive the
adaptive Skill Builder.

Hand-writing hundreds of these is slow. Asking a single LLM to write them is
fast and **dangerous**: one model will confidently produce a flawed question and,
asked to check its own work, confidently approve it. A model's blind spots are
correlated with themselves.

So the design goal here isn't "generate questions." It's **"generate questions
and produce trustworthy evidence about which ones are safe to ship,"** with a
human making the final call on anything the machines disagree about.

---

## The core idea: three independent models + code-authored verdicts + a human

Two principles do all the heavy lifting:

1. **Adversarial separation across model families.** Generation, checking, and
   tie-breaking are done by **three different model families** so that no single
   model's mistake can pass through unchecked. They are wired in
   `bedrock_text_client.py` (the *only* module that touches the network):

   | Role | Model family | Job |
   |---|---|---|
   | **Generator** | Anthropic **Claude Opus** | Write a new question + 5 options + its own flagged answer + a worked solution |
   | **Inspector** | **DeepSeek** (reasoning) | Re-solve the question *cold*, from scratch |
   | **Adjudicator** | **Qwen** (reasoning) | Break ties — invoked *only* when the first two disagree or flag ambiguity |

   Using unrelated lineages means **agreement is real signal**. When two
   independent reasoners land on the same answer, that's strong evidence the
   question is sound — far stronger than one model marking its own homework.

2. **The verdict is computed in our code, never read from a model.** A model is
   never asked "is this OK to ship?" The green/flagged decision is pure Python
   (`synthetic_triage.py`) derived from the *evidence* the models produced. A
   misbehaving model literally cannot mark its own output approved. And there is
   **no auto-reject** — the worst a question gets is *flagged for a human*.
   Nothing is ever silently dropped.

### "The firewall" — the most important detail

The Inspector's entry point is `cold_solve(question_text, options)`. **It has no
`correctIndex` parameter.** The Inspector physically cannot receive the
Generator's claimed answer, so it can't be biased toward it — the independence is
enforced by the function signature, not by a polite instruction in a prompt.
Whether the two answers agree is then decided by **deterministic code**
(`answer_match.py` / `synthetic_match.py`), not by a model, so agreement is
reproducible and auditable.

---

## Pipeline at a glance

```
handoff/questions.json  ← seeds (human-vetted, the SAME schema the app consumes)
        │
 [1] seed_selector.py        pick figure-less seeds, assign stable ordinals
 [2] generate_questions.py   Claude Opus → 5 questions per seed (difficulty 1..5)
 [3] inspect_questions.py    DeepSeek cold-solves each one     ← THE FIREWALL
 [4] synthetic_match.py      deterministic answer→index match  (pure, inline)
 [5] adjudicate_questions.py Qwen, ONLY on disagreement/ambiguity
 [6] synthetic_dedup.py      near-duplicate detection in-batch (pure, advisory)
 [7] synthetic_triage.py     green / flagged verdict           (pure, our code)
 [8] build_m6_review.py      join all evidence → review-bundle.json
        │
   review_app/m6.html  ← HUMAN reviews evidence, edits, approves/rejects
        │
   review/m6-decisions.json
        │
   build_handoff.py     validate + approved-only → handoff/questions.json
        │
   (app seed step) ───────────────────────────────► Aurora `questions` table
```

Each stage writes one small JSON artifact per question (`synthetic/<stage>/q-m6-NNN.json`).
That on-disk artifact *is* the idempotency key: every stage is **resumable** and
makes **at most one model call per question per stage** — a crashed run picks up
exactly where it stopped, and re-running never re-bills a slot.

---

## How each stage works

**1 · Seed selection (`seed_selector.py`)**
Reads the existing hardened bank (`handoff/questions.json`) and selects every
*figure-less* question to use as inspiration. (Figure questions are skipped —
the text-only models can't see the diagram.) Each seed gets a stable 1-based
*ordinal* assigned **before** any `--only`/`--limit` filtering, which is what
makes a 5-seed calibration run produce the exact same IDs as the full run.

**2 · Generation (`generate_questions.py` + `synthetic_prompts.py`)**
For each seed × difficulty `1..5`, Claude Opus writes one *new* question
(inspired by the seed, explicitly *not* a copy), with exactly five options, one
correct, and a worked solution — returned as strict JSON. IDs are deterministic:
`number = (ordinal − 1) × 5 + difficulty`, namespaced as `q-m6-NNN`
(`synthetic_ids.py`). No randomness, no wall-clock — a resumed run recomputes
identical IDs.

**3 · Cold inspection (`inspect_questions.py`)**
DeepSeek re-solves each question from the stem + options alone (the firewall),
returning its answer, its working, an independent difficulty estimate, and an
"is exactly one option correct?" judgement.

**4 · Deterministic matching (`synthetic_match.py` + `answer_match.py`)**
The Inspector's free-text answer (`"B"`, `"B) £23,460"`, `"151"`, …) is mapped to
an option index by ordered normalization tiers (letter → exact → loose →
numeric), each requiring *exactly one* option to match. Then we compare indices.
This runs inline with stage 3 because it's pure and cheap.

**5 · Adjudication (`adjudicate_questions.py`)**
Qwen is deliberately expensive, so it's only called when the Generator and
Inspector **disagree** or the Inspector flagged **ambiguity**. If they agree and
the item is clean, *no adjudication file is written at all* — its absence is
itself the "agreed + unambiguous" signal.

**6 · Deduplication (`synthetic_dedup.py`)**
Flags near-duplicate stems *within the current batch* (exact normalized match, or
Jaccard ≥ 0.9 on word sets). Purely **advisory** — a hit becomes a flag reason for
the human; nothing is auto-removed.

**7 · Triage (`synthetic_triage.py`)**
Pure function. A question is **green** only if *all* hold: the two solvers agree,
exactly one option is correct, the difficulty estimates are within tolerance, it's
not a near-duplicate, and no model call or parse failed. Otherwise it's
**flagged** with one stable reason string per failing check. Two verdicts only —
`green` and `flagged`. Never `rejected`.

**8 · Review bundle (`build_m6_review.py`)**
Joins the per-question artifacts and runs dedup + triage to produce
`synthetic/review-bundle.json`: for every question, all three models' evidence,
the verdict and its reasons, the duplicate list, and a pre-seeded decision
(`approve` for green, `null` for flagged).

---

## The human in the loop — what the reviewer actually does, and why

Open `review_app/m6.html` (served with `python -m http.server` from this
directory) and the operator gets one question at a time with the **full picture**:
stem and options with the proposed answer marked, the Generator's worked solution,
the Inspector's cold answer and reasoning, the Adjudicator's verdict when present,
the triage flags, and any in-batch duplicates (with "jump to").

The reviewer is the **answer authority**, and the app is built so the machines
can't shortcut that authority:

- **Green** items are pre-approved — a fast confirmation pass; one click flips any
  to reject.
- **Flagged** items start undecided, and the app **refuses to export a bare
  "approve"** until the reviewer has either edited a field (stem, options, correct
  answer, topic, difficulty) **or** explicitly ticked a "reviewed" confirmation.
  You cannot rubber-stamp a contested question by accident.

Decisions persist in `localStorage` and export as `m6-decisions.json`.

This split is the whole point: the model ensemble is excellent at **surfacing**
problems (disagreement, ambiguity, duplicates) but is not trusted to **resolve**
them silently. Confident-clean questions get a quick human nod; anything the
machines argued about gets real human judgement. For children's exam content,
that trade is worth the manual minutes.

### A real example from the data: `q-m6-005`

A digit-manipulation question where the true answer is **151**.
- **Claude** wrote it and flagged 151 — with a correct solution.
- **DeepSeek**, cold, *computed* 151 correctly across its working… then reported
  its final answer as the letter **"D"** (which was "158"). A self-inconsistency.
- The deterministic matcher mapped "D" → "158" → **disagreement** with 151.
- That mismatch triggered **Qwen**, which also computed 151 but visibly tangled
  its own letter↔option mapping in the rationale.
- Triage therefore marked it **flagged (answer_mismatch)** and sent it to a human.

Three models, three different stumbles, zero silent failures — and a person
resolves it in seconds. That's the system working exactly as designed.

---

## Output contract → the Aurora question bank

The deliverable, `handoff/questions.json`, is **the same shape the ApexMaths app
consumes** — it's the bridge between this offline tool and the production database.
`build_handoff.py` keeps only `approve` decisions and validates each one before it
ships:

- `text` — non-empty
- `options` — list of non-empty strings
- `correctIndex` — in range for the options
- `topic` — one of the six the product knows: `number`,
  `fractions_decimals_percentages`, `ratio_proportion`, `algebra`, `geometry`,
  `data_handling`
- `difficulty` — `1..5`
- no fields outside the product schema

Anything non-conforming is excluded and reported rather than shipped. The result
is loaded into the Aurora `questions` table by the app's seed step — and from
there it feeds the server-authoritative grader and the adaptive engine. The same
relational analytics that *report* a child's progress also *choose* their next
question, so the quality bar enforced here propagates through the whole product.

---

## Design properties worth calling out

- **One network module.** Only `bedrock_text_client.py` makes calls; everything
  else is pure or local file I/O, which keeps the trust-critical logic unit- and
  property-testable without a network.
- **Fail-flag, never fail-drop.** Every model response is parsed defensively; a
  garbled reply becomes a `status="failed"` artifact that triage flags, never a
  crash and never a silent omission. Even a model that returns the word `"easy"`
  instead of a number is coerced rather than allowed to break the run.
- **Determinism & resumability.** Stable IDs, per-question idempotency, and pure
  selection/triage make calibration runs reproducible and full runs restartable.
- **Path safety.** `common.assert_within_data` guards every write so the pipeline
  can only ever write inside its own directory.
- **Tested where it matters.** The pure, correctness-critical helpers (matching,
  triage, dedup, handoff validation) are covered by `pytest` + Hypothesis
  property tests under `pipeline/tests/`.

---

## Running it

Prerequisites: Python 3.13, the deps in `requirements.txt`, and AWS credentials
with Bedrock access in `eu-west-2`.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# Calibration first — prove the chain end-to-end on a handful of seeds:
python pipeline/generate_questions.py --limit 5
python pipeline/inspect_questions.py  --limit 5
python pipeline/adjudicate_questions.py
python pipeline/build_m6_review.py

# Review: serve this directory and open the review app
python -m http.server 8000
#   → http://localhost:8000/pipeline/review_app/m6.html
#   review, then "Export decisions" → save as review/m6-decisions.json

# Assemble the deliverable (validates; ships approved-only):
python pipeline/build_handoff.py            # writes handoff/questions.json
python pipeline/build_handoff.py --check    # re-validate an existing handoff

# Tests
pytest pipeline/tests
```

Every stage accepts `--only q-m6-001,...` and `--limit N` so you can scope a run
to a calibration subset; because IDs are stable, those subsets line up exactly
with the full run.

---

## Layout

```
Question_generation_pipeline/
├─ sources.json              # source registry (one synthetic source: "m6")
├─ requirements.txt
├─ handoff/questions.json    # IN: seeds  /  OUT: the deliverable bank
├─ review/m6-decisions.json  # the human's exported decisions
├─ synthetic/
│  ├─ generated/   inspected/   adjudicated/   # per-question artifacts
│  └─ review-bundle.json                       # joined evidence for the app
└─ pipeline/
   ├─ bedrock_text_client.py  # the ONLY network module (the 3 models)
   ├─ synthetic_prompts.py    # the 3 versioned prompts
   ├─ seed_selector.py  synthetic_ids.py
   ├─ generate_questions.py  inspect_questions.py  adjudicate_questions.py
   ├─ answer_match.py  synthetic_match.py  synthetic_dedup.py
   ├─ synthetic_triage.py     # the green/flagged authority (pure)
   ├─ build_m6_review.py  build_handoff.py  common.py
   ├─ review_app/             # the human-in-the-loop UI (static HTML/JS)
   └─ tests/                  # pytest + Hypothesis property tests
```

---

*Part of the ApexMaths H0 hackathon project. This pipeline is the content-trust
layer: it decides — with three independent models proposing and a human
disposing — which questions are good enough to put in front of a child.*
