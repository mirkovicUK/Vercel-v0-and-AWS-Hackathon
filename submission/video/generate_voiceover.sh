#!/usr/bin/env bash
#
# generate_voiceover.sh — Render the ApexMaths demo voiceover with Amazon Polly.
#
# Voice : Joanna (US English)
# Engine: neural  (most natural engine that is broadly available, incl. eu-west-2)
#         You can try the even-more-natural "generative" engine where it is
#         available (e.g. us-east-1): run with  ENGINE=generative  — but note
#         generative is region-limited and ignores some SSML tags.
#
# Output: scene1.mp3 … scene4.mp3 (sync each to its footage), plus a combined
#         apexmaths_voiceover.mp3 when ffmpeg is installed.
#
# Usage:
#   ./generate_voiceover.sh
#   ENGINE=generative AWS_REGION=us-east-1 ./generate_voiceover.sh
#
set -euo pipefail

# --- Config (override via environment) -------------------------------------
VOICE_ID="${VOICE_ID:-Joanna}"
ENGINE="${ENGINE:-neural}"
REGION="${AWS_REGION:-eu-west-2}"
OUTPUT_FORMAT="mp3"

# Resolve paths relative to this script so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSML_DIR="${SCRIPT_DIR}/ssml"
OUT_DIR="${SCRIPT_DIR}"
COMBINED="${OUT_DIR}/apexmaths_voiceover.mp3"

SCENES=(scene1 scene2 scene3 scene4)

# --- Pre-flight checks ------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: the AWS CLI ('aws') is not installed or not on PATH." >&2
  exit 1
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "ERROR: AWS credentials are not active. Configure them (aws configure /" >&2
  echo "       SSO / env vars) before running this script." >&2
  exit 1
fi

echo "Voice=${VOICE_ID}  Engine=${ENGINE}  Region=${REGION}"
echo "Rendering ${#SCENES[@]} scenes from ${SSML_DIR} ..."

# --- Synthesize each scene --------------------------------------------------
for scene in "${SCENES[@]}"; do
  ssml_file="${SSML_DIR}/${scene}.ssml"
  out_file="${OUT_DIR}/${scene}.mp3"

  if [[ ! -f "${ssml_file}" ]]; then
    echo "ERROR: missing SSML file: ${ssml_file}" >&2
    exit 1
  fi

  echo "  -> ${scene}.mp3"
  aws polly synthesize-speech \
    --region "${REGION}" \
    --engine "${ENGINE}" \
    --voice-id "${VOICE_ID}" \
    --output-format "${OUTPUT_FORMAT}" \
    --text-type ssml \
    --text "file://${ssml_file}" \
    "${out_file}" >/dev/null
done

echo "Per-scene MP3s written to ${OUT_DIR}"

# --- Optional: stitch into one track ---------------------------------------
if command -v ffmpeg >/dev/null 2>&1; then
  echo "Combining scenes into apexmaths_voiceover.mp3 (ffmpeg) ..."
  concat_list="$(mktemp)"
  for scene in "${SCENES[@]}"; do
    echo "file '${OUT_DIR}/${scene}.mp3'" >> "${concat_list}"
  done
  ffmpeg -y -f concat -safe 0 -i "${concat_list}" -c copy "${COMBINED}" >/dev/null 2>&1
  rm -f "${concat_list}"
  echo "Combined track: ${COMBINED}"
else
  echo "Note: ffmpeg not found — skipped the combined track."
  echo "      Install ffmpeg to auto-stitch, or import the four scene MP3s"
  echo "      directly into your video editor (recommended for syncing)."
fi

echo "Done."
