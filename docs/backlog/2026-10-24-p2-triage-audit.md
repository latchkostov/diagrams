## P2 queue triage audit (2026-10-24)

Evidence baseline: `origin/master` `7b6e905130a970fe6701422ee1408ce6c6058973` (merged history from 2026-10-18 through #276). The local queue archive SHA-256 is `160d7902210d080982f62c1d4a0037a47005641b71ae3d20feb6ad57d1e3bdd0`. The original 49,875 bytes are kept at `C:/Users/latch/bin/codex-tasks/queued-p2-fu10.archive.md`; the working queue is now an index. Neither local queue file is committed.

**259 distinct actionable engineering findings: 164 DONE, 1 STALE, 94 OPEN, across 26 candidate PR batches.** Six OPEN owner decisions are counted separately. Counts are deduplicated findings, not reviewer votes, queue headings, or status counts of tests run during this triage.

| Theme                                                           | DONE | STALE | OPEN | Candidate PR batches |
| --------------------------------------------------------------- | ---: | ----: | ---: | -------------------: |
| [Accessibility and focus](2026-10-24-p2-accessibility-focus.md) |   16 |     0 |    9 |                    1 |
| [Lazy loading](2026-10-24-p2-lazy-loading.md)                   |   12 |     0 |    7 |                    2 |
| [Message types](2026-10-24-p2-message-types.md)                 |    8 |     0 |   13 |                    2 |
| [Line editing and routes](2026-10-24-p2-line-editing-routes.md) |   11 |     0 |    7 |                    3 |
| [Hover and Live cards](2026-10-24-p2-hover-live-cards.md)       |   13 |     1 |   16 |                    3 |
| [Engine and sampling](2026-10-24-p2-engine-sampling.md)         |   22 |     0 |   15 |                    7 |
| [Tests and CI](2026-10-24-p2-tests-ci.md)                       |   60 |     0 |   18 |                    4 |
| [Review tooling](2026-10-24-p2-review-tooling.md)               |   12 |     0 |    2 |                    1 |
| [Performance](2026-10-24-p2-performance.md)                     |   10 |     0 |    7 |                    3 |

## How dispositions were checked

Read the queue, current implementations and corresponding tests; compared local merged commit history and targeted `git log -S` history for changed regressions. The fixing PR links in each theme point to commits reachable from the evidence baseline. No review artifact in another worktree was opened. Historical test paths are resolved to current `.heavy.test.ts` locations where appropriate. A test moved into the heavy lane is not automatically treated as a fixed timeout.

Repeated lenses and later restatements are consolidated by defect, with the original queue retained as the audit source. In particular: the four simulation-reference findings are one comparison issue; repeated oversized-filter focus findings are one issue; paged-rule Undo and Carries bounds are each one issue; repeated pinned-target deletion findings are one issue; repeated Forge checkpoint and failed-Cancel findings share their fixes; repeated retry CPU-contention requests are one issue. A single queue sentence containing independent fixes is split into separate items.

DONE requires an existing implementation or the specifically requested regression plus a merged fixing PR. STALE is used only for removed implementation/snapshot instructions, not for unresolved or unreproduced failures. OPEN coverage requests remain open even where nearby tests pass. Owner recommendations and organization/distribution questions stay separate.

## Duplicate backlog fragments merged and removed

- `2026-10-23-message-card-escape.md` → [2026-10-24-p2-message-types.md](2026-10-24-p2-message-types.md).
- `2026-10-22-request-findings-by-target.md` → [2026-10-24-p2-engine-sampling.md](2026-10-24-p2-engine-sampling.md).
- `2026-10-23-breaker-probe-caller-outcome.md` → [2026-10-24-p2-engine-sampling.md](2026-10-24-p2-engine-sampling.md).
- `2026-10-24-bundle-headroom-trims.md` → [2026-10-24-p2-performance.md](2026-10-24-p2-performance.md).
- `2026-10-21-pr225-review-p2.md` → [2026-10-24-owner-decisions.md](2026-10-24-owner-decisions.md).

The narrowed-probe note retains this known bound: the caller dot remains unsplit while connections split the test calls; the discrepancy can be up to `scale - halfOpenCalls` real caller outcomes per successful recovery. The old measurement was 95 real requests per closing batch at scale 100 and 3,600/s, with matching connection counters. Reproduce before designing the call-level split.

Other backlog fragments are retained when they carry independent bugs, seeded counterexamples, quarantines or historical failure evidence. In particular, the message-loop proof quarantine, deferred searchable-menu quarantine, resource-recovery fuzzer counterexample, sampled CPU-placement design, and native-load/teardown evidence are not duplicates of an implementation task and are not closed by this triage.

## Process notes retained in the local queue index

No stash: use signed WIP commits in this worktree. Historical cross-worktree stash-recovery paths remain only in the local archive. Do not operate on another worktree. Native environment/toolchain observations require current evidence before changing dependencies. Old canvas-byte merge-order estimates are superseded; use current measured headroom with unchanged budgets. The parked searchable-menu draft remains quarantined until its native-input/controller ownership design is sound. No code fix, owner decision, golden update or release was made by this documentation task.
