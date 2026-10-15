# Autoscaling A1 round 2 review dispositions

Review: `.reviews/20261015-063116/REPORT.md` (10 P1, 8 P2), after rebasing onto the
merged self-hosting work in `origin/master` on 2026-10-15. All findings were verified;
several reviewers independently reported the same defect. None was dismissed as a false positive.

| Report finding                                         | Disposition and regression                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 accessibility: incomplete optional numbers          | Fixed: capture native bad input before interpreting an empty optional field. Sequential `1e`, Tab and repair preserve saved CPU limits, requests and memory limits.                                                                                  |
| P1 architecture: fleet reservation invariants          | Fixed with the concurrency/acquisition findings below. Fleet code owns concurrency reconfiguration; existing ownership survives decreases and checkpoints.                                                                                           |
| P1 architecture: one HPA commit path                   | Fixed: numeric, resource and JSON candidates share complete validation. Invalid drafts remain local with feedback.                                                                                                                                   |
| P1 correctness: availability on concurrency edits      | Fixed: rebuild partial eligibility on reconfiguration; regression increases one occupied replica from one to four slots, then decreases to two.                                                                                                      |
| P1 correctness: retained retries while down            | Fixed: a due down-node retry can fail without executing CPU. Exact and sampled tests exhaust three deliveries with backoff and zero CPU.                                                                                                             |
| P1 correctness: starting replicas reverse shrink       | Fixed: the conservative missing-sample adjustment cannot exceed the preceding desired count for a shrink recommendation.                                                                                                                             |
| P1 performance: sampled admission rescans              | Fixed: compact only after readiness or protected work boundaries change. Eight hundred overlapping admissions perform zero existing-work visits.                                                                                                     |
| P1 security: jitter hashes long node IDs repeatedly    | Fixed: hash the complete node identity once per fleet, then mix replica IDs. Character-read counts stay unchanged when startup grows from 1,250 to 10,000.                                                                                           |
| P1 security: merged paste budget                       | Fixed with the P2 architecture finding: shared editor precommit checks validate the composed lifecycle budget and policy. Paste, duplicate, single, bulk and replacement property regressions preserve a readable document.                          |
| P1 types: failed acquisition before admission          | Fixed: reserve before removing pending work; failed acquisition starts no work and charges no CPU. Explicit injected acquisition failure is covered independently of the concurrency regression.                                                     |
| P2 accessibility: RTL JSON                             | Fixed: policy textarea alone uses LTR; the Arabic production test checks computed direction.                                                                                                                                                         |
| P2 architecture: pasted/bulk lifecycle budget          | Fixed with P1 security above. Existing localized recovery guidance reports the budget refusal.                                                                                                                                                       |
| P2 performance: paginate before expanding identities   | Fixed: count ranges arithmetically, rank the page boundary and consult an ordered used-identity index. Early and late pages of idle and previously used 10,000-replica fleets construct at most fifty rows per page and never traverse the used map. |
| P2 performance: draining counts scan used replicas     | Fixed: maintain exact and sampled drain counts during reconciliation and release. Readouts never call the used-replica iterator.                                                                                                                     |
| P2 tests: numerical replica readings                   | Fixed: per-replica rolling CPU uses complete one-second samples, including before fifteen seconds. Known-work unit assertions and production aggregate/replica comparisons cover both sides of fifteen seconds and the current unpublished second.   |
| P2 tests: constant-work guard accepts linear traversal | Fixed: deterministic collection visits and property reads through stepping and frames must match at 1,250 and 10,000 previously used idle replicas. Removed the permissive wall-clock ratio.                                                         |
| P2 tests: successful Advanced JSON                     | Fixed: a complete modified policy replaces an invalid draft, persists all settings, clears feedback and undoes in one step.                                                                                                                          |
| P2 types: numeric policy validation                    | Fixed with the P1 architecture commit path; the window maximum also subtracts metric delay.                                                                                                                                                          |

## Choices

Rejected imposing a new node-ID length restriction: hashing once removes multiplicative startup work
without rejecting existing documents. Rejected raising timing thresholds or recording unexplained
goldens. No new controls or global resource badges were added. The existing public showcase still
covers startup, backlog and draining within ten seconds; this batch adds no new simulation feature.

## Regression verification

Production fixes were temporarily restored to the rebased HEAD, tested, then restored byte for byte:
all twelve targeted simulation cases and six editor cases failed. The old optional-input, numeric-policy
and RTL controls each failed their production browser regression. Deliberately rejecting every JSON
policy failed the new successful-edit/undo test.

A deliberate per-used-replica traversal failed the constant-work guard (1,001,717 visits versus 126,717).
The old sampled admission performed 320,400 existing-work visits where the fixed path performs zero.
Old early/late pagination constructed 10,051 idle rows or 20,000 previously used rows across two pages;
the fixed path constructs at most 100. Removing current-second CPU retention, immediate-work release,
resource-enablement queuing, queued-edit preservation or queued-budget validation also failed their
specific regressions. Every temporary regression was reverted before final validation.

## Validation

- `pnpm test --maxWorkers=2`: 6,514 passed, four skipped; all 498 files passed, no type errors.
  The earlier four-worker run had one existing `infra/pick.test.ts` five-second timeout (6,508 passed).
  No timeout or assertion threshold was changed.
- Final focused simulation/editor run: 139 passed, no type errors.
- Production Chromium: all 126 autoscaling, Live, sim-truth, planning P1/P2/P3 and capacity tests passed
  twice, using explicit ports 6230–6234. Negative browser controls used 6235–6239. Servers were stopped.
- `pnpm build`, `pnpm size`, `pnpm i18n check`: passed. Entry gzip is 104.0 kB against a 123.5 kB budget.
  i18n has existing missing-translation/glossary warnings and zero errors; this batch adds no messages.
- `pnpm parity`: all 1,552 goldens match, including the Docker browser tier. An intervening run alongside
  e2e encountered the documented automatic-fit timing issue in the legacy HTML viewer (viewport only,
  plus its screenshot). The isolated final full run passed; no goldens were re-recorded.
- `pnpm skill:check`: the released viewer matches a fresh build. Plugin 1.1.19 is exactly one patch above
  `origin/master`'s 1.1.18.

The first lint gate caught a callback's void-union annotation and three test-only non-null assertions.
Those were corrected; 139 focused checks and all eleven production A1 tests passed again.
Lint, typecheck and formatting are the final gate after the last edit, immediately before the signed commit.
