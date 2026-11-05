## Tutorial keyboard and import retry checks under Linux load

Two existing failures reproduce on clean `origin/master` at
`9cb33865770b2b89aebf9c5fc7b5146900e0bca3`, without the caching tutorial batch.
The comparison used this worktree temporarily checked out at that commit, with no
working edits; the feature branch was restored afterward. No full master suite ran.

## Reproduction

Run `pnpm gate quick tests/e2e/tutorials-keyboard-2.spec.ts tests/e2e/tutorials.spec.ts
--only e2e --linux --repeat 2 --workers 12 --cpus 12 --ports 6760 --max-wait 1`.

- `boundaries: keyboard solution plays through the real UI` fails both repetitions:
  keyboard traversal cannot reach `rf__node-group:boundary-1` and cycles back through
  the canvas and inspector controls. The synced feature branch reproduces the same
  target and traversal failure.
- `tutorial parser chunk: Skip failure retries successfully through the real import
bridge` fails once: the runner reaches `report`, but `toast-import-details` is absent.
  The other repetition passes. The feature branch also observed an absent details toast
  in the separate Continue variant before syncing; that variant is not claimed as an
  identical clean-master reproduction.

## Clean-master result

```text
SUMMARY: 9cb33865770b2b89aebf9c5fc7b5146900e0bca3 | unit="not run" parity="not run" e2e={"passed":317,"failed":3,"flaky":0,"skipped":0} gate_failures=2
```

## Follow-up

Check group keyboard ownership during focus handoff, and the import details toast's
lifecycle across Retry and report publication. Preserve the existing assertions and
budgets. The caching batch does not change the boundaries lesson or import bridge.
