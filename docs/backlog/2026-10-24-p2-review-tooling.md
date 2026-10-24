## P2 triage: Review tooling (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 12 / STALE 0 / OPEN 2 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Review tooling (2 OPEN)

1. **RT-01 — OPEN: Explicit issue identity must override fuzzy matching.** `scripts/review/triage.mjs:62`. Queue: #266/#270.
   Unknown previousId is reset to null before matching, so it can inherit an unrelated old identity by title/location. Preserve supplied-unknown versus absent identity and test both cases beside an outstanding P1.

2. **RT-02 — OPEN: Collect whole-PR filenames without rebuilding full scope.** `scripts/review/prepare.mjs:75`. Queue: #270.
   Delta review recomputes full reviewScope to obtain names, repeating patch/context work. Add a filenames-only helper and assert one delta patch calculation plus one name-only diff.

## Closed or superseded findings

| ID    | Status | Finding and current evidence                                                                                                                                                              | Fixing PR / reason                                       |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| RT-03 | DONE   | **Serialize branch-state compare and replacement** — `scripts/review/state.mjs:10`. The OS lock covers reading expected state, constructing replacement and atomic rename.                | [#266](https://github.com/latchkostov/diagrams/pull/266) |
| RT-04 | DONE   | **Conflicting assessments preserve outstanding P1s** — `scripts/review/triage.mjs:101`. Every lens must assess each prior P1; only unanimous fixed assessments resolve it.                | [#266](https://github.com/latchkostov/diagrams/pull/266) |
| RT-05 | DONE   | **Detached review derives identity from the PR** — `scripts/review/prepare.mjs:28`. The PR-backed path resolves branch identity without relying on the checkout branch.                   | [#268](https://github.com/latchkostov/diagrams/pull/268) |
| RT-06 | DONE   | **Full means whole PR and audit means whole repo** — `scripts/review/prepare.mjs:49`. Full/audit are standalone scopes and do not advance branch review state.                            | [#268](https://github.com/latchkostov/diagrams/pull/268) |
| RT-07 | DONE   | **PR identity does not overwrite saved intent** — `scripts/review/prepare.mjs:20`. Saved context survives --pr; explicit brief/refresh-intent controls replacement.                       | [#270](https://github.com/latchkostov/diagrams/pull/270) |
| RT-08 | DONE   | **Whole-PR context is distinguished from the fix delta** — `scripts/review/triage.mjs:128`. Reports carry the saved delta since SHA and separate PR file context.                         | [#270](https://github.com/latchkostov/diagrams/pull/270) |
| RT-09 | DONE   | **Consolidate same-file same-line findings across lenses** — `scripts/review/triage.mjs:81`. The exact-location rule clusters different titles without discarding raw lens evidence.      | [#270](https://github.com/latchkostov/diagrams/pull/270) |
| RT-10 | DONE   | **Unknown prior IDs no longer crash round merging** — `scripts/review/triage.mjs:54`. They warn and become new findings; the separate identity/fuzzy-match ambiguity remains OPEN.        | [#270](https://github.com/latchkostov/diagrams/pull/270) |
| RT-11 | DONE   | **Known-flake classification checks every error** — `scripts/ci/known-flakes.mjs:52`. A timeout signature cannot hide a second assertion/hook failure after #270 tightens classification. | [#267](https://github.com/latchkostov/diagrams/pull/267) |
| RT-12 | DONE   | **Reject reports from previous workflow attempts** — `scripts/ci/known-flakes.mjs:124`. Current attempt, upload timestamps and uniqueness are verified during collection.                 | [#270](https://github.com/latchkostov/diagrams/pull/270) |
| RT-13 | DONE   | **Retain nested suite hook errors** — `scripts/ci/vitest-json.mjs:7`. Machine-readable reports recursively retain hook/setup errors.                                                      | [#270](https://github.com/latchkostov/diagrams/pull/270) |
| RT-14 | DONE   | **Probe exclusions use repo-relative paths** — `scripts/operation-probes.ts:20`. Checkout directory names no longer accidentally disable instrumentation.                                 | [#270](https://github.com/latchkostov/diagrams/pull/270) |

## Scope and verification

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
