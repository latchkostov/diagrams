## Cache purge review round one (#435)

Purge validation and the simulation editor now walk the same stable playback
order, including setup and earlier property edits.
Configuration snapshots are shared between property edits, so repeated fault
steps do not copy every node again. Deleted rule IDs remain
visible as unresolved choices with a linked field error, so choosing All rules
explicitly repairs the step. Accepted hard, soft, per-rule and deploy menu
purges announce completion through the canvas live region in all 38 languages.
Completion copy loads with the cache surface; it needs no extra download.

Stale-hit analysis counts only the portion of each refresh before the original
stale deadline. A soft purge at time zero retains existing tracked and statistical
copies; a hard purge is the negative control. Soft invalidation preserves the
statistical refill clock and cannot create missing copies. Background refreshes
participate in pending/failure accounting; failed or stalled origin work cannot
extend the last successful fill's freshness plus stale deadline.

Statistical refresh credit dispatches one weighted batch per sampled arrival,
preserving real-unit origin work. Dispatch stops before allocating at the existing
100,000-call capacity and retains unspent credit. Tracked items still own one real
fetch each. All flight registration, lookup, observation and cleanup share a
discriminated key helper, including delimiter-bearing rule IDs.

## Regression evidence and unchanged limits

Every finding has a failing mutation check: 14 rejected mutations cover the
11 findings, including separate zero-time tracked/statistical cases and the
missing-rule placeholder/error. The named latency regression covers two hard
and two soft purges, aggregate and per-type windows, cumulative counters and
checkpoint replay. Existing fill-bounded freshness tests continue passing.
The statistical ownership oracle checks each batch's exact credited weight;
tracked-flight ownership remains exactly one real request.

No agreement bound, example chip threshold, budget, reserve or checkpoint limit
was raised. Live measures 128,782 bytes gzip, 34 fewer than the starting head,
leaving 74 bytes under its 128,856-byte reserve. The lazy cache runtime is 4,679
bytes against 5,120. Arabic core is 37,980 bytes against 38,000.

## Intentional golden changes

Exactly three goldens change:

- `node/i18n/catalogs.json`: one completion message in every catalog, including
  the generated pseudo-locale; other message areas are unchanged.
- `node/planning/cache-stampede.json`: the three stale-enabled simulations now
  count the remaining stale window correctly. The expected origin rate changes
  from 23.93124690635487 to 23.931263676555588 requests/s, with matching derived
  connection, utilization and explanation values. The original two simulations
  are unchanged.
- `node/sim/black-friday-commerce/edge-deploy.json`: the later soft purge retains
  the incomplete refill from the earlier hard purge instead of inventing warm
  tail copies. Weighted statistical refreshes preserve their real-unit work.
  More tail misses and background work reach the origin; dependent throughput,
  counts, in-flight work and latency follow that schedule. At the golden seed,
  end offload is 93.8544061302682% and shopper p95 is 230.39077633131436 ms;
  all unchanged chips pass. The hard-deploy checkpoints are unchanged.

The initial full parity check compared 3,358 goldens and found only these three
intended differences; all 112 Linux browser checks passed with no browser golden
changes. No new goldens are added. These correctness changes are recorded
explicitly; no assertion or tolerance was weakened to absorb them.

## Focused verification

The 56 focused cache/editor/action regressions pass, including failed and stalled
origin refreshes and removed default-rule choices. All 18 cache-scenario
engine digests agree on Chromium, Firefox and WebKit. The short-stale-window
agreement regression uses five seeds and 100,000 requests per case. Its maximum
absolute hit-ratio errors are 0.8123 percentage points at scale 1, 0.8123 at
scale 10 and 0.6123 at automatic scale, below the unchanged 2/3-point bounds.
The exact independent 48-seed sweep and complete Linux Build/Dev gates remain
required for the final branch verification; their final results accompany the
pushed revision report.
