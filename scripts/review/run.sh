#!/usr/bin/env bash
# Scoped Codex review. Usage and round policy: scripts/review/README.md.
#   pnpm review [--brief file] [--pr number] [--since ref] [--allow-round-4]
#   ANGLES="correctness tests" pnpm review
#   pnpm review --full  # whole PR; does not advance state
#   pnpm review --audit # explicit repository audit; does not advance state
set -euo pipefail
cd "$(dirname "$0")/../.."
MODEL="${CODEX_MODEL:-gpt-6.1-sol}"
EFFORT="${CODEX_EFFORT:-high}"
out=".reviews/$(date +%Y%m%d-%H%M%S)-$$"
node scripts/review/prepare.mjs "$out" "$@"
pids=()
trap 'for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done' EXIT
for angle in $(cat "$out/angles.txt"); do
  prompt="$(cat scripts/review/common.md; echo; cat "$out/prompt.md"; echo; cat "scripts/review/angles/$angle.md")"
  codex exec -m "$MODEL" -c "model_reasoning_effort=\"$EFFORT\"" -s danger-full-access \
    --output-schema scripts/review/findings.schema.json -o "$out/$angle.json" - <<<"$prompt" \
    >"$out/$angle.log" 2>&1 &
  pids+=("$!")
done
failed=0
for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
pids=()
if (( failed )); then
  echo "Review incomplete; inspect $out/*.log. Round state was not advanced." >&2
  exit 1
fi
node scripts/review/merge.mjs "$out"
echo "Report: $out/REPORT.md"
