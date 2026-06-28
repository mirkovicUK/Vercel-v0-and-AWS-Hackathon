"""
bedrock_text_client.py — the ONLY network module in the synthetic (m6) pipeline.

A text-only Bedrock Converse wrapper. It standardises:

  - REGION = eu-west-2, the boto3 Config (read timeout = per-call timeout, no
    boto retries), the _RETRYABLE_CODES set, exponential backoff up to
    MAX_RETRIES, the NoCredentials/PartialCredentials/AccessDenied → named
    PipelineError mapping, endpoint-error retry, and _extract_text (Req 11.2,
    11.3, 11.4, 11.7).

Three public calls, one per model family, each parsed defensively so a garbled
model response becomes a `status="failed"` artifact the triage stage can flag
rather than a crash (Req 11.5):

  - generate(seed_text, seed_topic, difficulty) -> Generator (Claude Opus) draft
  - cold_solve(question_text, options)           -> Inspector (DeepSeek) — THE
    FIREWALL: the signature has NO correctIndex parameter (Req 3.1, 3.2)
  - adjudicate(question_text, options, gen_answer_index, insp_answer_text)
                                                  -> Adjudicator (Qwen) verdict

Requirements: 2.4, 3.1, 3.2, 3.4, 5.3, 11.2, 11.3, 11.4, 11.7.
"""

from __future__ import annotations

import json
import re
import time

import boto3
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    NoCredentialsError,
    PartialCredentialsError,
    EndpointConnectionError,
    ReadTimeoutError,
    ConnectTimeoutError,
)

from common import PipelineError
from synthetic_prompts import (
    build_generate_prompt,
    build_cold_solve_prompt,
    build_adjudicate_prompt,
    GENERATE_PROMPT_VERSION,
    COLD_SOLVE_PROMPT_VERSION,
    ADJUDICATE_PROMPT_VERSION,
)

# --- region + model ids (Converse, eu-west-2) ------------------------------
# Three DISTINCT model families so a single model's blind spot cannot pass
# unchecked: Claude generates, DeepSeek solves cold, Qwen adjudicates.
REGION = "eu-west-2"
GENERATOR_MODEL = "eu.anthropic.claude-opus-4-6-v1"
INSPECTOR_MODEL = "deepseek.v3.2"
ADJUDICATOR_MODEL = "qwen.qwen3-235b-a22b-2507-v1:0"

# Converse generation config.
MAX_TOKENS = 1200
# The Generator returns a full question PLUS a worked solution, so it needs more
# headroom than the solver/adjudicator calls. The 5-seed dry run showed
# difficulty 4-5 questions truncating mid-solution at 1500 (a long step-by-step
# worked solution + 5 options overruns the cap), so raise to 3500.
GENERATOR_MAX_TOKENS = 3500
# deepseek/qwen emit long chain-of-thought in steps/rationale; 1200 truncated
# hard-question responses in the dry run.
REASONING_MAX_TOKENS = 3000
TEMPERATURE = 0.2
# The Inspector/Adjudicator are reasoning models (deepseek/qwen): a single hard
# question can take well over a minute to solve. Give the per-call read timeout
# generous headroom (3 min) so a slow-but-legitimate reasoning call is not cut
# off mid-flight. The boto Config read_timeout below uses this value.
PER_CALL_TIMEOUT_S = 180
MAX_RETRIES = 3
BACKOFF_BASE_S = 1.0

# Throttling / transient error codes worth retrying.
_RETRYABLE_CODES = {
    "ThrottlingException", "TooManyRequestsException",
    "ServiceUnavailableException", "ModelTimeoutException",
    "InternalServerException",
}

_client = None


def _get_client():
    global _client
    if _client is None:
        cfg = Config(
            region_name=REGION,
            read_timeout=PER_CALL_TIMEOUT_S,
            connect_timeout=10,
            retries={"max_attempts": 0},  # we do our own retry/backoff
        )
        _client = boto3.client("bedrock-runtime", config=cfg)
    return _client


def _converse_text(model_id: str, prompt: str,
                   max_tokens: int = MAX_TOKENS) -> str:
    """Issue ONE text-only Converse call (a single text content block, no image)
    with bounded retry/backoff. Returns the model's text output. Maps
    credential/access failures to a named PipelineError (Req 11.2, 11.3, 11.4)."""
    client = _get_client()
    messages = [{
        "role": "user",
        "content": [
            {"text": prompt},
        ],
    }]
    inference_config = {"maxTokens": max_tokens, "temperature": TEMPERATURE}

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.converse(
                modelId=model_id,
                messages=messages,
                inferenceConfig=inference_config,
            )
            return _extract_text(resp)
        except (NoCredentialsError, PartialCredentialsError) as e:
            raise PipelineError(
                f"AWS credentials unavailable — configure the AWS CLI before "
                f"running (model {model_id}): {e}"
            )
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            emsg = e.response.get("Error", {}).get("Message", "")
            if code in ("AccessDeniedException", "AccessDenied"):
                raise PipelineError(
                    f"Bedrock access denied for {model_id} in {REGION}. Likely "
                    f"causes: the account is not entitled to this model, or model "
                    f"access is not enabled. AWS said: {emsg}"
                )
            if code in _RETRYABLE_CODES and attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_BASE_S * (2 ** attempt))
                last_err = e
                continue
            raise PipelineError(f"Bedrock call failed for {model_id}: {code or e}: {emsg}")
        except EndpointConnectionError as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_BASE_S * (2 ** attempt))
                last_err = e
                continue
            raise PipelineError(f"Could not reach Bedrock endpoint for {model_id}: {e}")
        except (ReadTimeoutError, ConnectTimeoutError) as e:
            # A reasoning model can be persistently slow; retry with backoff like
            # an endpoint error, then surface a named PipelineError so the stage
            # script writes a status="failed" artifact (flagged) instead of the
            # raw timeout crashing the whole batch.
            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_BASE_S * (2 ** attempt))
                last_err = e
                continue
            raise PipelineError(
                f"Bedrock call timed out for {model_id} after "
                f"{PER_CALL_TIMEOUT_S}s read timeout: {e}"
            )
    # exhausted retries
    raise PipelineError(f"Bedrock call failed for {model_id} after "
                        f"{MAX_RETRIES} attempts: {last_err}")


def _extract_text(resp: dict) -> str:
    """Pull the concatenated text blocks out of a Converse response."""
    content = resp.get("output", {}).get("message", {}).get("content", [])
    parts = [b.get("text", "") for b in content if "text" in b]
    return "".join(parts).strip()


def _parse_json(raw: str) -> dict | None:
    """Defensively extract a JSON object from a model's raw text. Tolerates
    ```json ... ``` fences and leading/trailing prose by grabbing the first
    {...} block. Returns the parsed dict on success, or None on garbage."""
    if not isinstance(raw, str) or not raw.strip():
        return None

    candidate = raw.strip()
    # strip a ```json ... ``` or ``` ... ``` fence if present
    fence = re.search(r"```(?:json)?\s*(.+?)```", candidate, re.DOTALL | re.IGNORECASE)
    if fence:
        candidate = fence.group(1).strip()

    obj = _try_json(candidate)
    if obj is None:
        # last resort: grab the first balanced-looking {...} span
        m = re.search(r"\{.*\}", candidate, re.DOTALL)
        if m:
            obj = _try_json(m.group(0))

    if obj is None or not isinstance(obj, dict):
        return None
    return obj


def _try_json(s: str):
    try:
        return json.loads(s)
    except (json.JSONDecodeError, ValueError):
        return None


# Common difficulty words a reasoning model may emit instead of the int 1..5 the
# prompt asks for. Mapped case-insensitively to the nearest point on the scale.
_DIFFICULTY_WORDS = {
    "very easy": 2,
    "easy": 2,
    "medium": 3,
    "moderate": 3,
    "hard": 4,
    "difficult": 4,
    "very hard": 5,
}


def _coerce_difficulty(value) -> int | None:
    """Normalise a model-reported difficulty to an int 1..5, or None.

    The prompt asks for an integer 1..5, but a reasoning model sometimes returns
    a word ("easy") or a numeric string ("3"). Coerce defensively so downstream
    triage always sees int|None and never crashes on `abs(gen - insp)`:
      - an int in 1..5 is returned as-is;
      - a leading digit parsed from a numeric string ("3" -> 3) is kept if 1..5;
      - a known word ("easy"/"medium"/"hard"/...) maps to its scale point;
      - anything else (out-of-range, unknown word, bool, None) returns None.
    """
    # bool is an int subclass; never treat True/False as a difficulty.
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 1 <= value <= 5 else None
    if isinstance(value, float):
        ival = int(value)
        return ival if 1 <= ival <= 5 else None
    if isinstance(value, str):
        s = value.strip().lower()
        if not s:
            return None
        word = _DIFFICULTY_WORDS.get(s)
        if word is not None:
            return word
        m = re.match(r"\s*(\d+)", s)
        if m:
            ival = int(m.group(1))
            return ival if 1 <= ival <= 5 else None
        return None
    return None


# --- public API ------------------------------------------------------------

def generate(seed_text: str, seed_topic: str, difficulty: int) -> dict:
    """Generator (Claude Opus). Build the generate prompt, call the Generator
    model, and parse the JSON draft defensively. On success returns
    {text, options, correctIndex, generatorSolution, model, promptVersion,
    status="ok"} (the model's "solution" key is mapped to generatorSolution).
    On parse failure returns {status="failed", raw, model, promptVersion} so the
    stage script can persist a failed artifact for triage to flag (Req 11.5)."""
    prompt = build_generate_prompt(seed_text, seed_topic, difficulty)
    raw = _converse_text(GENERATOR_MODEL, prompt, max_tokens=GENERATOR_MAX_TOKENS)
    obj = _parse_json(raw)
    if obj is None:
        return {
            "status": "failed",
            "raw": raw,
            "model": GENERATOR_MODEL,
            "promptVersion": GENERATE_PROMPT_VERSION,
        }
    return {
        "text": obj.get("text"),
        "options": obj.get("options"),
        "correctIndex": obj.get("correctIndex"),
        "generatorSolution": obj.get("solution"),
        "model": GENERATOR_MODEL,
        "promptVersion": GENERATE_PROMPT_VERSION,
        "status": "ok",
    }


def cold_solve(question_text: str, options: list[str]) -> dict:
    """Inspector (DeepSeek). THE FIREWALL: this signature has NO correctIndex
    parameter — the Inspector code path cannot receive the Generator's flagged
    answer (Req 3.1, 3.2). Builds the cold-solve prompt, calls the Inspector
    model, and parses defensively. On success returns
    {answer, steps, difficulty, exactlyOneCorrect, model, promptVersion,
    status="ok"}; on parse failure returns a failed record."""
    prompt = build_cold_solve_prompt(question_text, options)
    raw = _converse_text(INSPECTOR_MODEL, prompt, max_tokens=REASONING_MAX_TOKENS)
    obj = _parse_json(raw)
    if obj is None:
        return {
            "status": "failed",
            "raw": raw,
            "model": INSPECTOR_MODEL,
            "promptVersion": COLD_SOLVE_PROMPT_VERSION,
        }
    return {
        "answer": obj.get("answer"),
        "steps": obj.get("steps"),
        "difficulty": _coerce_difficulty(obj.get("difficulty")),
        "exactlyOneCorrect": obj.get("exactlyOneCorrect"),
        "model": INSPECTOR_MODEL,
        "promptVersion": COLD_SOLVE_PROMPT_VERSION,
        "status": "ok",
    }


def adjudicate(question_text: str, options: list[str],
               gen_answer_index: int, insp_answer_text: str) -> dict:
    """Adjudicator (Qwen). Build the adjudicate prompt — passing the Generator's
    ANSWER TEXT (options[gen_answer_index]) as gen_answer and the Inspector's
    free-text answer as insp_answer — call the Adjudicator model, and parse
    defensively. On success returns {correctAnswer, unresolved,
    exactlyOneCorrect, rationale, model, promptVersion, status="ok"}; on parse
    failure returns a failed record (Req 5.3)."""
    gen_answer_text = options[gen_answer_index]
    prompt = build_adjudicate_prompt(
        question_text, options, gen_answer_text, insp_answer_text
    )
    raw = _converse_text(ADJUDICATOR_MODEL, prompt, max_tokens=REASONING_MAX_TOKENS)
    obj = _parse_json(raw)
    if obj is None:
        return {
            "status": "failed",
            "raw": raw,
            "model": ADJUDICATOR_MODEL,
            "promptVersion": ADJUDICATE_PROMPT_VERSION,
        }
    return {
        "correctAnswer": obj.get("correctAnswer"),
        "unresolved": obj.get("unresolved"),
        "exactlyOneCorrect": obj.get("exactlyOneCorrect"),
        "rationale": obj.get("rationale"),
        "model": ADJUDICATOR_MODEL,
        "promptVersion": ADJUDICATE_PROMPT_VERSION,
        "status": "ok",
    }
