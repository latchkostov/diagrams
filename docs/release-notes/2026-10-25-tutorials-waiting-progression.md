## Waiting tutorial progression

Fixed all four findings from PR #326 round one. Skipping a caller-property edit or using Continue now reaches a separately checked Live-entry step before choosing the comparison run, so following the lesson never toggles an already-running session off. Watch steps require their subject’s readout as well as the observed metrics. Billing’s final reading step explains how to expand Latency and waits for Done, giving learners time to compare Waiting and Working.

The four available waiting lessons use version two so saved step indexes and completion from the older instructions restart safely. No runner behavior or simulation output changed.

The only changed golden is `tests/parity/goldens/node/i18n/catalogs.json`: two new Billing reading messages and revised comparison/rerun instructions update English catalog hashes, message totals and fallback counts. The other two targeted i18n goldens are unchanged. Generated viewer assets were refreshed with `pnpm regen`.
