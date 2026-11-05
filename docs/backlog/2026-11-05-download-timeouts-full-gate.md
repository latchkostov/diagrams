## Download timeouts in the complete Linux gate

The single complete Linux gate on caching code commit
`e52e831a64d87583ae9311ad142d74b838282e9d` used six workers and CPUs. All caching
pointer, keyboard, assistance, reconstruction and outcome checks passed. Five
existing browser checks timed out:

- `review-358.spec.ts`: SVG export includes complete titles and routes from focus.
  The download path remained pending until the 30-second test timeout cancelled it.
- `trim-first-view.spec.ts`: stencil download keeps canvas cursors, focus and exports;
  file and image exports skip a held pinned library; phone transport during overflow
  loading and Retry. Each hit the existing 30-second timeout; cleanup reported a
  cancelled download rather than a completed transfer.
- `tutorials-apply-present.spec.ts`: batch-six SVG/PNG exports and an offline HTML
  story hit the existing 90-second test timeout.

```text
SUMMARY: e52e831a64d87583ae9311ad142d74b838282e9d | unit={"passed":16820,"failed":0,"skipped":13} parity={"goldens":3358,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":3465,"failed":5,"flaky":0,"skipped":12} gate_failures=1
```

## Affected-spec comparison

In this same worktree, clean `origin/master` at
`9cb33865770b2b89aebf9c5fc7b5146900e0bca3` ran only those three specs, twice,
with six workers and CPUs in Linux. Both repetitions passed all 51 checks. The
feature branch was restored afterward. No full master suite or second complete
feature suite ran, following the verification budget.

```text
SUMMARY: 9cb33865770b2b89aebf9c5fc7b5146900e0bca3 | unit="not run" parity="not run" e2e={"passed":102,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

These are **unreproduced full-run timeouts**, not proven identical pre-existing
failures. The comparison does not establish their cause. During the full run the
container used about 6.9 GiB of 31.2 GiB RAM, and its filesystem had about 779 GiB
free; those observations do not establish memory or disk exhaustion.

## Follow-up

Investigate browser download completion and cancellation across a long suite,
including held imports and SVG/PNG/HTML exports. Keep the existing timeouts,
assertions, simulation engine and bundle budgets. Caching code was not changed
after its complete gate; this fragment records the result for the next fix round.
