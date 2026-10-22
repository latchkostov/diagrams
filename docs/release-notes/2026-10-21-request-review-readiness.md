## Request checks: readiness, timing and bounded verification

Agent checks now wait for request findings for the exact diagram content. Pending or failed checks cannot
be reported as clean. Workers and the local fallback publish complete findings to one shared result store,
including disabled rules, so displayed fixes remain actionable when workers are unavailable.

Timeout Checks and live advice share the callee's selected endpoint latency, API or model latency,
downstream waiting and round-trip network delay. No timeout is offered when a normal response cannot fit
the caller's thread budget. Free-play verification inputs are built once, lazily, only after admission to
the same work budget used by live fix verification.

Keyboard focus survives alternative fixes that remove several findings. Blocking cycles remain marked
as potentially deadlocked when unrelated non-blocking calls belong to the same request component.

## Output parity

No additional goldens changed beyond the existing 329-golden feature inventory. All 2,869 goldens match,
with zero additions, missing files or stale files. Bundle budgets are unchanged; entry gzip is 108.7 kB
against the existing 123.5 kB limit.

## Review verification

The targeted 81 unit/type checks and 21 browser cases passed three times. Temporarily reverting the
readiness, fallback cache, endpoint estimates, replay preparation, cycle and focus fixes reproduced the
regressions. The broader quick-gate unit set passed 13,698 checks with eight skips.

[PR CI for the reviewed head](https://github.com/latchkostov/diagrams/actions/runs/39695531260) passed all
six browser shards. Neither the download round trip nor the slow-motion transition failed there; this
does not establish a master regression. Initial local verification exposed a new test's missing number
separator and asset 404s caused by overlapping build outputs; the corrected stable-bundle run passed.
The initial Linux load pass also exhausted one test's overall timeout after its correct timeout toast;
the same diagnosis, persistence and Undo assertions now run after the first complete 11-second window
instead of 15 seconds of virtual replay. No assertion or test timeout was relaxed.

## Second review round

- **Capacity defers only where it's replaced.** A caller diagnosed by `blocked-threads` or `scaling-blind` is
  left out before the capacity check picks the busiest service, so another overloaded service keeps its
  warning. A broker that only feeds the diagnosed caller isn't reported in its place: its capacity is what that
  caller drains. When neither waiting check runs (a capacity-only check, or both turned off), capacity keeps
  its own warning and never waits for request checks. A fix's recheck runs the same rules the card did.
- **Readers pass what they awaited.** `check_diagram` and fixes hand the awaited request findings to
  `runChecks`, so a background recheck or a full cache can't turn a ready result back into "pending". A
  recheck of content that is already ready keeps it ready; an older attempt never overwrites a newer one; a
  failure goes to that attempt's callers and the next call starts again. Agent replies check privacy and the
  open document before reporting a failure, in words that say nothing about the diagram.
- **Run simulations never waits.** Playing simulations needs only the no-reader check, so the main-thread
  fallback runs whether request checks are missing, pending or failed.
- **Bounded output.** Names in request findings are cut at 200 characters (never inside a character); one
  diagram's request findings stay within 1,000,000 characters, warnings first. The diagram keeps its labels.
- **Only real calls.** Dead-letter routes, deny rules and `share: 0` connections are neither the blocking cause
  nor timeout findings (the waiting plan's own test, now one shared function).
- **One analysis.** The worker and the no-worker fallback build one context for request findings and the other
  checks; timeout fixes read the context's edge index.
- **Focus.** Applying an edit clears the selection, and the inspector's findings with it: focus now goes to
  the inspector's body instead of the page. Results that later remove the focused finding restore focus in
  the inspector as they do in the card.

### Output parity

Three goldens differ from the previous head, all already in the 329-file inventory:
`node/agent/check/{blocking-call,scale-on-busy-threads,corpus-w1-busy-threads}.json`. Their `oneRule` case
(`rules: ["dead-letter", "capacity"]`) runs capacity without the waiting checks, so it reports capacity's
own findings again; that section is now identical to master's. No other golden changed.

## Third review round

- **Scenario sizing stays lazy without a worker.** The worker and the no-worker fallback now run one function
  (`src/checks/execute.ts`). Its context works out scenario sizing only when a check reads it: the capacity
  check, or a blocked caller's verified fix. A diagram with capacity off and no such fix plays no simulation on
  the main thread.
- **Bounded results say they're bounded.** Request findings past the budget are counted by rule and reported as
  `CheckResult.omitted`: the summary (Checks card and `check_diagram`) says how many more weren't listed, and a
  bounded result never reads as "Nothing to check". Timeout suggestions past the budget are only counted, never
  built.
- **Outages stay visible.** A broker saved down or paused keeps its capacity warning beside a diagnosed caller;
  only a healthy broker's backlog is left to the caller's finding.
- **Overlapping attempts.** Only the newest attempt for a content publishes its result; an older one only fills a
  gap. Every caller still gets its own attempt's result.

No golden changed in this round.
