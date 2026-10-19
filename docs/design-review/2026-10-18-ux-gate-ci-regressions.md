## Outage capacity and launch cancellation review

Restore the existing capacity chip under a down node when Show capacity is enabled. It explains
where offered traffic waits; throughput and latency remain hidden while down. No control, tab stop,
menu item or new wording is added. The existing outage simulation demonstrates the behavior at its
4 s marker, and its 12 s marker restores the healthy label.

Re-entering Live after cancelling a pending launch follows the owner's first-simulation default.
Both keyboard and toggle regressions distinguish that default from the cancelled simulation.

## Rejected alternatives

Do not move the outage assertions to a weaker status-only badge: that would lose the waiting-topic
explanation and hide the product regression. Do not restore stale throughput or latency. Do not
change the first-simulation default or merely remove the cancelled-launch assertion.

## Verification

Both complete specs passed three Linux repetitions: 177 passed, zero failed or flaky. Deliberately
reintroducing the capacity bug and disabling cancellation failed the three targeted regressions;
restoring the code passed all three. All 2,530 parity goldens matched, including 91 Linux browser
cases before synchronization. Sync regenerated the catalog golden for master's two presence
messages; no diagram golden changed and no chrome or output golden was added.
