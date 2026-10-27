## Live view memory gate and rail coverage

Ordinary Live sessions no longer prefetch slow-motion replay code when idle. The first slow-motion
start still downloads it through the existing capturing/loading path. The memory gate's four extra
nodes were module-preload links for replay, script, routeWords and journey, rather than rail labels
or descriptions. Their delayed, one-time download could land in the second measurement window and
report 0.8 nodes per cycle. Benchmarks and budgets are unchanged.

The fixed memory suite passes all eight gates natively and in Linux, with Live view at 0.0 DOM
nodes per cycle, matching master. The regression test fails with the idle prefetch restored.

The desktop rail now scrolls in short windows, keeping every action reachable without scrolling the
page. Phone More continues to open outside the bottom bar. French and Spanish tests verify full
accessible names and tooltips, including Checks counts and the return-to-Diagram action.

## Output parity

This fix adds no diagram, simulation or export output changes. During sync, `node/i18n/catalogs.json`
was regenerated to combine this PR's nine rail messages with upstream copy changes. Its rail hashes,
message/fallback counts and shared message-types Add hash reflect the existing translation feature;
no other golden changes.
