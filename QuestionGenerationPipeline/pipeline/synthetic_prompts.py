"""
synthetic_prompts.py — prompt builders for the synthetic (m6) question pipeline.

Three prompts, each versioned by a constant so a Generated_Question /
Inspector_Result / Adjudicator_Verdict can record exactly which prompt produced
it (Req 2.3, 3.3, 5.3):

  - the Generator prompt (stage 2): produce ONE multiple-choice 11+ maths
    question at a given difficulty on the seed's topic, inspired by — but not a
    copy of — the seed; exactly five options, exactly one correct, with wording
    and scenario DISTINCT from the seed's sibling difficulties, plus a clear
    worked solution. STRICT JSON (Req 2.3, 3.1).
  - the cold-solve prompt (stage 3): solve the question from scratch, given ONLY
    the question text and options. It NEVER sees the Generator's correct index
    and is forbidden from reasoning about any "intended" answer (Req 3.1, 3.3).
  - the adjudicate prompt (stage 5): given the question, options, and the two
    solvers' answers, judge which (if any) option is correct, whether the item
    is unresolved, and whether exactly one option is correct (Req 5.3).

Keeping all three here — alongside their version constants — makes the prompts
easy to find, audit, and bump without touching the network or business logic.
Pure module: no IO.

Requirements: 2.3, 3.1, 3.3, 5.3.
"""

from __future__ import annotations

# Bump these when the prompt text changes; recorded on every artifact.
GENERATE_PROMPT_VERSION = "m6-generate-v1"
COLD_SOLVE_PROMPT_VERSION = "m6-cold-solve-v2"
ADJUDICATE_PROMPT_VERSION = "m6-adjudicate-v1"


def _format_options(options: list[str]) -> str:
    """Render options as 'A) ...' lines for the solver/adjudicator prompts."""
    return "\n".join(f"  {chr(65 + i)}) {o}" for i, o in enumerate(options))


def build_generate_prompt(seed_text: str, seed_topic: str, difficulty: int) -> str:
    """Generator instruction. The model is given a seed question for INSPIRATION
    plus a target topic and difficulty, and must produce ONE new multiple-choice
    question (not a copy) with exactly five options and exactly one correct, as
    STRICT JSON (Req 2.3, 3.1)."""
    return "\n".join([
        "You are an expert author of UK 11+ (eleven-plus) maths questions for "
        "children aged 10–11. Write ONE original multiple-choice question.",
        "",
        f"TOPIC: {seed_topic}",
        f"DIFFICULTY: {difficulty} on a 1–5 scale, where 1 is the easiest and 5 "
        "is the hardest. Pitch the reasoning, numbers, and number of steps to "
        "match this difficulty exactly.",
        "",
        "SEED QUESTION (for INSPIRATION ONLY — do NOT copy it):",
        seed_text,
        "",
        "REQUIREMENTS:",
        "- Produce exactly ONE question on the topic above, inspired by the seed "
        "but clearly DISTINCT from it — not a reworded copy.",
        "- Provide exactly FIVE answer options.",
        "- Exactly ONE option must be correct; the other four must be plausible "
        "but wrong.",
        "- This question is one of five built from the same seed at difficulties "
        "1–5. Make its wording and scenario DISTINCT from the sibling "
        "difficulties: vary the phrasing and the real-world scenario, not just "
        "the numbers.",
        "- Include a clear, step-by-step worked solution that explains how to "
        "reach the correct option.",
        "- Keep the language age-appropriate and unambiguous.",
        "",
        "Return STRICT JSON ONLY — no prose, no markdown, no code fences — with "
        "exactly these keys:",
        "{",
        '  "text": string,           // the question wording',
        '  "options": string[5],     // exactly five answer options',
        '  "correctIndex": integer,  // index 0..4 of the single correct option',
        '  "solution": string        // step-by-step worked solution',
        "}",
        "",
        "Return ONLY the JSON object and nothing else.",
    ])


def build_cold_solve_prompt(question_text: str, options: list[str]) -> str:
    """Cold-solve (Inspector) instruction. THE FIREWALL: the model is given ONLY
    the question text and the five options — never the correct-answer index — and
    must solve from scratch, forbidden from guessing any "intended" answer
    (Req 3.1, 3.3)."""
    return "\n".join([
        "You are solving a UK 11+ (eleven-plus) maths multiple-choice question "
        "from scratch, as an independent second opinion.",
        "",
        "QUESTION:",
        question_text,
        "",
        "OPTIONS:",
        _format_options(options),
        "",
        "STRICT RULES:",
        "- Solve the question yourself, step by step, using only the question and "
        "the options above.",
        "- Do NOT try to guess which option the author 'intended' to be correct.",
        "- Do NOT reason about any 'intended', 'expected', or 'marked' answer — "
        "there is none available to you. Work out the answer purely from the "
        "maths.",
        "- Independently judge the difficulty on a 1–5 scale (1 easiest, 5 "
        "hardest). Report it as an INTEGER 1-5 ONLY — a single digit, never a "
        "word like 'easy' or 'hard'.",
        "- Independently judge whether EXACTLY ONE option is correct and "
        "unambiguous.",
        "",
        "Return STRICT JSON ONLY — no prose, no markdown, no code fences — with "
        "exactly these keys:",
        "{",
        '  "answer": string,             // the option you chose: its text or its letter A–E',
        '  "steps": string,              // your step-by-step working',
        '  "difficulty": integer,        // integer 1-5 ONLY — not a word like \'easy\'',
        '  "exactlyOneCorrect": boolean  // true iff exactly one option is correct and unambiguous',
        "}",
        "",
        "Return ONLY the JSON object and nothing else.",
    ])


def build_adjudicate_prompt(question_text: str, options: list[str],
                            gen_answer: str, insp_answer: str) -> str:
    """Adjudicator instruction. Given the question, options, and the two solvers'
    answers, the model judges which (if any) option is correct, whether the item
    is unresolved, and whether exactly one option is correct, as STRICT JSON
    (Req 5.3)."""
    return "\n".join([
        "You are the deciding judge for a UK 11+ (eleven-plus) maths "
        "multiple-choice question. Two independent solvers gave answers and you "
        "must adjudicate.",
        "",
        "QUESTION:",
        question_text,
        "",
        "OPTIONS:",
        _format_options(options),
        "",
        "SOLVERS' ANSWERS:",
        f"  Solver 1 answered: {gen_answer}",
        f"  Solver 2 answered: {insp_answer}",
        "",
        "YOUR TASK:",
        "- Solve the question yourself, then decide which option (if any) is "
        "correct.",
        "- Decide whether the question is unresolved — that is, no single option "
        "can be confidently chosen as correct.",
        "- Decide whether EXACTLY ONE option is correct and unambiguous.",
        "",
        "Return STRICT JSON ONLY — no prose, no markdown, no code fences — with "
        "exactly these keys:",
        "{",
        '  "correctAnswer": string,      // the correct option as a letter A–E, or its text',
        '  "unresolved": boolean,        // true iff no single option can be confidently chosen',
        '  "exactlyOneCorrect": boolean, // true iff exactly one option is correct and unambiguous',
        '  "rationale": string           // brief justification for your judgement',
        "}",
        "",
        "Return ONLY the JSON object and nothing else.",
    ])
