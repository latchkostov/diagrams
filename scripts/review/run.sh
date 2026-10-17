#!/usr/bin/env bash
# Multi-angle Codex review. Usage:
#   scripts/review/run.sh                 # changes since branch review-base (or the whole repo if it doesn't exist)
#   scripts/review/run.sh --full          # whole codebase
#   scripts/review/run.sh --since <ref>   # changes since <ref>
#   ANGLES="correctness tests" scripts/review/run.sh
# Reports: .reviews/<stamp>/<angle>.json and a merged REPORT.md (gitignored).
# After fixes land, mark the reviewed point: git branch -f review-base HEAD
set -uo pipefail
cd "$(dirname "$0")/../.."
MODEL="${CODEX_MODEL:-gpt-6.1-sol}"
EFFORT="${CODEX_EFFORT:-high}"
ANGLES="${ANGLES:-correctness architecture performance tests security accessibility types}"

scope="full"; since=""
if [[ "${1:-}" == "--full" ]]; then scope="full"
elif [[ "${1:-}" == "--since" ]]; then scope="diff"; since="$2"
elif git rev-parse --verify -q review-base >/dev/null; then scope="diff"; since="review-base"
fi

stamp="$(date +%Y%m%d-%H%M%S)"
out=".reviews/$stamp"; mkdir -p "$out"
if [[ "$scope" == "diff" ]]; then
  # Three dots: only this branch's changes since it forked, not newer commits on the base.
  range="$since...HEAD"
  scope_text="Review ONLY the changes in \`git diff $range\` (run \`git diff --stat $range\` and \`git log --oneline $range\` first), reading surrounding code as needed for context."
else
  scope_text="Review the whole codebase (src/, tests/, configs). Prioritize the most important modules."
fi
echo "Reviewing ($scope${since:+ since $since}) with $MODEL/$EFFORT → $out"

for angle in $ANGLES; do
  prompt="$(cat scripts/review/common.md; echo; echo "Scope: $scope_text"; echo; cat "scripts/review/angles/$angle.md")"
  # The Windows sandbox helper is unreliable, so reviewers run unsandboxed and are told to stay read-only.
  codex exec -m "$MODEL" -c "model_reasoning_effort=\"$EFFORT\"" -s danger-full-access \
    --output-schema scripts/review/findings.schema.json -o "$out/$angle.json" - <<<"$prompt" \
    >"$out/$angle.log" 2>&1 &
done
wait
node scripts/review/merge.mjs "$out"
echo "Report: $out/REPORT.md"

echo "After triage: add dated fragments in docs/backlog/ and docs/design-review/; see docs/PARALLEL-WORK.md."
