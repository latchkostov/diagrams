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

## Fourth review round

- **Timeouts against playback's ticks.** The one timeout function (Checks and the callout's Add a timeout) now
  compares against playback's completion of a normal reply, tick rounding and network legs included, and offers a
  value only when it's strictly later. An 11 ms API behind four threads at 150 req/s no longer gets a 20 ms timeout
  that every reply would hit. A sweep applies each offered fix and plays it: no normal reply times out.
- **Replica alternative.** When sizing a consumer also adds partitions, the chip, its accessible name, tooltip and
  toast name the broker change; a browser test applies it by keyboard, checks the scaler is off with the fixed
  count, and undoes both in one step.
- **Deadlock wording** only counts calls playback makes (shared `activeCall`): a loop through a zero-share, denied
  or dead-letter connection, or back from an API or store, isn't a thread deadlock. The existing mixed-cycle test
  now uses services on both loops, as playback requires for a call back.
- **Referable fixes.** A request fix or option whose ops would name an id longer than edit ops accept isn't
  offered; the finding stays.
- **Agents.** `check_diagram` with simulations projects findings, ignored, ran and omitted counts together for the
  requested rules (`onlyRules`). Request checks fetched for an agent or a fix run no other rule (a worker operation
  of their own), and plan scenarios only when a blocked caller's fix reads them.

No golden changed.

## Startup budget

The request-check store no longer ships at startup or with the canvas: startup registers only the provider
(`src/lib/requestCheckProvider.ts`), and the store is a chunk of its own, loaded with the first check (and by
the Checks card, agents and fixes, which already load lazily). `bundle/startup/gzip` is 176,496 B (budget
177,000 B) and `bundle/canvasFirstView/gzip` 382,345 B (budget 383,000 B); no budget was raised. A held store
keeps focus, cursor, styles and export working, and checks arrive after it; a failed download offers Retry from
the Checks card and keeps focus in the canvas (`tests/e2e/request-checks-chunk.spec.ts`).

## Callout verification timing

CI's "Add a timeout names the saved simulation…" test pressed the trouble callout's button while it still offered
Events: the trace shows `data-action="events"` ("Show events") at the key press and the confirmed
`add-timeout` only afterwards. The callout offers Events until the checks worker's same-seed replay confirms a fix
(#225's design). That replay runs in real time while the test drives the page's mocked clock. The replay's cost is
unchanged by this PR (about 220 ms in Node on f2e5074e and here). The test left about 1.2 s between the callout
and its key press; under load, the worker's start-up plus the replay used it up.

- Live view now starts the checks worker when it starts watching a diagram whose callouts can verify a fix
  (revision p3-w1), so the worker's download and start-up are no longer between a callout and its confirmed fix.
- The test waits for the confirmed `add-timeout` action before pressing it; every assertion after it is unchanged.
  Under load (all `requests-wait*` specs, three times, production build) it passes 147/147; without the wait it
  failed twice in the same run, with Events pressed.

## Skill download after merging #232

Merging master's #232 (master alone: 834,880 B) took the skill ZIP to 835,588 B against the unchanged 835,000 B
cap. Packaging now also tries filtered matching (memory level 7) for each entry and keeps the smallest lossless
stream, as it already did for hash-table sizes: the icon catalog's many similar SVG paths compress about 1.5 kB
smaller. The archive is 834,096 B with identical names, timestamps, CRCs and decompressed contents; no skill text
was removed and no budget raised.

## Fifth review round: timeouts verified by playback

- **Timeout fixes are verified by replay.** The shared analytic function only proposes a deadline (now with the
  callee's maximum latency jitter in its completion bound). Checks offer it, and the callout's Add a timeout
  considers it, only when a bounded same-seed headless replay of free play (the diagram's own rates, no faults)
  with the deadline applied times out none of that call's replies (`timeoutKeepsReplies`, src/live/threadFixPlan.ts,
  with the existing replay contract and work budget). Over budget, or with no calls to judge by, no timeout is
  offered; the finding stays. New regressions apply every offered fix and play it: default and larger jitter, and
  nested model-API calls (a 1 ms model calling an 11 ms service). The payment example keeps its 600 ms.
- **Capacity-only agent checks with simulations** report the requested rules' own findings (capacity keeps its
  warning unless a waiting check was asked for too), with the evidence the full classification attached.
- **Request findings are worked out only when an enabled rule reads them**; a skipped computation is never stored as
  an empty result.
- **Retry reruns the check that failed** when the Checks card's code arrives, without an edit.
- The held-store e2e now checks the SVG download completes, with the diagram in it, before releasing the store.

### Output parity

28 goldens differ from the previous head, all already in the 329-file inventory: `node/agent/check`, `node/checks`,
`node/checks-words` and `node/evidence` for the seven W1 corpus diagrams (`corpus-w1-blocking`, `-gateway`,
`-held-drain`, `-inflight-cap`, `-join-failure`, `-nonblocking`, `-sampling`). Their diagrams have no free-play
traffic (traffic comes only from saved simulations), so no replay can confirm a timeout: each `call-timeout` finding
stays, without its unverified Add a 1000 ms (or 2000 ms) timeout fix, and agent summaries lose the fix hint.
No other golden changed; the public examples' fixes are unchanged.
