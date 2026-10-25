## Segment Tab-stop race review

The regression keeps the existing keyboard contract: Home, End and arrows select a choice,
only the selected segment is a Tab stop, and Tab leaves the group for Timeout. It waits for
the saved choice and both segments' checked/tabindex attributes after each move, so an earlier
choice cannot satisfy the next step's readiness check. The final focus assertion is unchanged.

No controls, focus policy, layout or text change. Sleeps, retries, longer timeouts and a weaker
focus assertion are unnecessary. The CI trace shows stale controlled state during the key
sequence rather than focus being stolen by a lazy section.

## Reproduction and mutation check

The failed [CI run](https://github.com/latchkostov/diagrams/actions/runs/40157008556/attempts/1)
trace shows Frees focused but unchecked before ArrowLeft, then Holds unchecked with tabindex -1
when Tab is sent. The earlier blocking-state checks had passed before the End update arrived.

All local repetitions use the pinned Playwright Linux image, six workers, two CPUs and zero retries:

```sh
pnpm gate quick tests/e2e/inspector-layout.spec.ts:443 --linux --only e2e --repeat-each 30 --workers 6 --cpus 2 --max-wait 1 --ports 6720
```

| Test version                          | Passed | Failed | Flaky |
| ------------------------------------- | ------ | ------ | ----- |
| Original                              | 20     | 10     | 0     |
| Committed-choice waits                | 30     | 0      | 0     |
| Waits temporarily reverted (mutation) | 23     | 7      | 0     |
| Waits restored                        | 30     | 0      | 0     |

The original run includes two failures at the reported deadline-focus assertion, four at the
post-arrow checked-state assertion, and four at the saved-policy assertion. The mutation removes
only the test change; product code is identical throughout. Verification stays on the named
regression for this fix round; the full suite and parity are left to CI. No goldens change.
