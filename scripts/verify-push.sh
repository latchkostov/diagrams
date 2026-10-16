#!/usr/bin/env bash
# Full local production gate. Invoked by ~/bin/verify-push.sh from this worktree.
set -uo pipefail
base="${1:?usage: verify-push.sh <port-base>}"
if ! [[ "$base" =~ ^[0-9]{1,5}$ ]] || (( 10#$base < 1 || 10#$base > 65531 )); then
  echo "verify-push: expected a port base from 1 to 65531"; exit 2
fi
base=$((10#$base))
for ((p=base; p<=base+4; p++)); do
  case "$p" in 5190|6000) echo "verify-push: port range includes forbidden port $p"; exit 2;; esac
done
root="$(git rev-parse --show-toplevel)" || exit 2
cd "$root" || exit 2
# All worktrees share this key. Independent gates otherwise overlap Vitest's worker
# pools, production builds and browsers, saturating the host and starving page startup.
# OS-owned locks release on termination; no stale PID files or lock directories.
if [ "${LD_GATE_REENTRY:-}" != 1 ]; then
  common="$(git rev-parse --git-common-dir)" || exit 2
  mkdir -p "$common/verified" || exit 2
  export LD_GATE_REENTRY=1
  case "$(uname -s)" in
    MINGW*|MSYS*)
      export LD_GATE_COMMON="$(cygpath -am "$common")"
      export LD_GATE_SCRIPT="$(cygpath -am "$0")" LD_GATE_PORT="$base"
      export LD_GATE_BASH="$(cygpath -am "$(command -v bash)")"
      powershell.exe -NoProfile -NonInteractive -Command "$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'
$key = [IO.Path]::GetFullPath($env:LD_GATE_COMMON).ToLowerInvariant()
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))).Replace('-', '') }
finally { $hasher.Dispose() }
$name = 'Global' + [char]92 + 'LiveDiagramsGate-' + $hash
$mutex = [Threading.Mutex]::new($false, $name)
$owned = $false
$status = 2
try {
  try { $owned = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $owned = $true }
  if (!$owned) {
    [Console]::WriteLine('Waiting for another full local gate (shared repository lock)...')
    [Console]::Out.Flush()
    try { $owned = $mutex.WaitOne() }
    catch [Threading.AbandonedMutexException] { $owned = $true }
  }
  & $env:LD_GATE_BASH $env:LD_GATE_SCRIPT $env:LD_GATE_PORT
  $status = $LASTEXITCODE
} finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
exit $status
POWERSHELL
)"
      exit "$?"
      ;;
    *)
      if ! flock -n "$common/verified/local-gate.lock" true; then
        echo 'Waiting for another full local gate (shared repository lock)...'
      fi
      flock --close "$common/verified/local-gate.lock" bash "$0" "$base"
      exit "$?"
      ;;
  esac
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "verify-push: commit or stash your changes first (the stamp is for HEAD exactly)."; exit 2
fi
sha="$(git rev-parse HEAD)" || exit 2
stampdir="$(git rev-parse --git-common-dir)/verified"
mkdir -p "$stampdir" tests/.output/local-gate || exit 2
# Chrome's file:// loader on Windows rejects MAX_PATH-length exports even when
# Node can read them. Keep the run prefix short; the full SHA lives in the log/stamp.
run="$(mktemp -d tests/.output/local-gate/run-XXXXXX)" || exit 2
# A failed rerun must not leave an earlier success authorizing this HEAD.
rm -f "$stampdir/$sha"
log="$run/gate.log"
printf 'verify-push HEAD %s\nLog: %s\n' "$sha" "$log" | tee -a "$log"
start=$(date +%s)
gate_failures=0
step() {
  echo "== $1" | tee -a "$log"
  shift
  if ! "$@" >> "$log" 2>&1; then
    gate_failures=$((gate_failures + 1))
    echo "FAILED: $* (see $log)" | tee -a "$log"
    tail -40 "$log"
  fi
}
step "lint" pnpm -s lint
step "typecheck" pnpm -s typecheck
step "format" pnpm -s format:check
step "unit" pnpm -s test
step "build" pnpm -s build
step "entry size" pnpm -s size
if grep -q '"parity"' package.json; then step "parity" pnpm -s parity; fi

export E2E_TARGET=build E2E_PORT=$base E2E_DEV_PORT=$((base + 1)) E2E_PREVIEW_PORT=$((base + 2)) \
       E2E_INTERNAL_PORT=$((base + 3)) E2E_LOCKED_PORT=$((base + 4)) E2E_CHROMIUM_ONLY=1
# Always build this checkout. Limit browsers like CI, but never hide a local flake behind retries.
unset E2E_PREBUILT
export PLAYWRIGHT_HTML_OPEN=never
passed=0 failed=0 flaky=0 skipped=0
for n in 1 2 3 4 5 6; do
  shard="$run/shard$n"
  mkdir -p "$shard"
  echo "== e2e shard $n/6" | tee -a "$log"
  if ! list="$(node scripts/e2e-shard.mjs "$n" 6)" || [ -z "$list" ]; then
    echo "FAILED: cannot list shard $n" | tee -a "$log"
    gate_failures=$((gate_failures + 1))
    continue
  fi
  read -r -a specs <<< "$list"
  export PLAYWRIGHT_JSON_OUTPUT_NAME="$shard/results.json"
  export PLAYWRIGHT_HTML_OUTPUT_DIR="$shard/report"
  code=0
  npx playwright test "${specs[@]}" --project=chromium --workers=3 --retries=0 \
    --output="$shard/results" --reporter=list,html,json > "$shard/playwright.log" 2>&1 || code=$?
  cat "$shard/playwright.log" >> "$log"
  # JSON avoids Windows line endings, terminal colour codes and reporter wording.
  report_code=0
  counts="$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    try {
      const r = JSON.parse(readFileSync(process.argv[1], "utf8"));
      const s = r.stats;
      const counts = [s.expected, s.unexpected, s.flaky, s.skipped];
      if (counts.some(n => !Number.isSafeInteger(n) || n < 0) || !counts.some(Boolean)) throw Error("empty report");
      console.log(...counts);
      if (s.unexpected || s.flaky || r.errors?.length) process.exitCode = 1;
    } catch (err) {
      console.error("Invalid shard report:", err.message);
      console.log("0 0 0 0");
      process.exitCode = 1;
    }
  ' "$PLAYWRIGHT_JSON_OUTPUT_NAME")" || report_code=$?
  read -r sp sf sk ss <<< "$counts"
  passed=$((passed + sp)); failed=$((failed + sf)); flaky=$((flaky + sk)); skipped=$((skipped + ss))
  echo "shard$n: $sp passed, $sf failed, $sk flaky, $ss skipped (exit $code)" | tee -a "$log"
  if ((code != 0 || report_code != 0)); then
    gate_failures=$((gate_failures + 1))
    echo "FAILED: e2e shard $n/6 (see $shard/playwright.log)" | tee -a "$log"
    tail -25 "$shard/playwright.log"
  fi
done
if [ "$(git rev-parse HEAD)" != "$sha" ] || [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "FAILED: HEAD or tracked files changed during verification" | tee -a "$log"
  gate_failures=$((gate_failures + 1))
fi
summary="SUMMARY: $sha | shards=6 passed=$passed failed=$failed flaky=$flaky skipped=$skipped gate_failures=$gate_failures"
echo "$summary" | tee -a "$log"
if ((gate_failures != 0)); then exit 1; fi
mins=$(( ($(date +%s) - start) / 60 ))
printf 'verified %s in %s min\n%s\n' "$sha" "$mins" "$summary" > "$stampdir/$sha"
echo "OK: HEAD $sha verified (full gate). You may push it."
