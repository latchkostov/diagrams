## Live cancellation and outage capacity regressions

The cancelled-launch checks now request the non-default Payments outage simulation. After cancelling
through either the Live toggle or L while the session downloads, re-entering Live must select the
example's first simulation, Black Friday, and must not replay the cancelled Payments outage.

The missing Payments capacity label was a product regression, not a renamed or relocated element.
The fault-chip review change hid every capacity chip on a down node along with stale throughput and
latency. Capacity already uses the current outage state: its label says **Down** and names the topic
where traffic waits. Restore that label while keeping stale throughput and latency hidden. The
regression retains the Down/waiting assertions and now also checks the hidden stale metrics and the
healthy label after recovery. Boundary-aware Restore and Clear fault behavior are unchanged.

## Output parity

Before synchronization, `pnpm parity` passed: 2,530 goldens, zero changed, added, missing or stale;
all 91 Linux browser cases passed. The capacity fix changes no diagram output.

Synchronization with master required regenerating the conflicting `node/i18n/catalogs.json` with
`pnpm parity:update i18n` as earlier branch commits replayed. This is the only golden changed from
the pre-sync branch: master's two presence messages (`collab.joined` and `collab.left`) increase
catalog message/fallback counts by two and change the `collab` hashes. Every other golden is
unchanged. The golden was generated from the combined catalog, never hand-merged.

Full post-sync parity also passed: 2,530 goldens, zero differences, and all 91 Linux browser cases.
The three affected browser cases, build/size, i18n and skill freshness passed on the rebased tree.

## Validation

The pre-fix Linux run reproduced exactly the three reported failures (56 passed, three failed).
Both complete specs then passed three Linux gate repetitions with four workers sharing three CPUs:
177 passed, zero failed, zero flaky. No assertion or timing wait was relaxed.

Temporarily restoring the down-node capacity guard and disabling `cancelRun` failed all three
targeted checks: the label disappeared and both cancelled launches replayed Payments outage.
Restoring the code passed all three on the production bundle.

Build and entry-size checks passed (108.9 kB gzip against 123.5 kB). The full local unit run had
11,349 passes, four skips and one five-second sync-test timeout; its isolated branch rerun and two
isolated clean-master runs passed. The new backlog fragment records the evidence without claiming
a reproduced master failure or changing the timeout.
