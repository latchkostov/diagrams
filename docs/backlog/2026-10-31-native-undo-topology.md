## Compare the restored rendered topology after measurement

macOS shard 3 of Nightly 41183332686 fails the entry-point Undo case after correctly removing the added node and edge. At the comparison, the five original node elements are present but hidden for React Flow measurement and all four original edge elements are absent. The later failure snapshot and screenshot show those same four edges restored. The Undo result is not a persistent loss of the original edges.

The test now requires the initial four edges before recording its baseline, then waits for the exact complete baseline topology after Undo and the exact added topology after Redo. It keeps the individual added-node/edge removal assertions and the same full equality oracle; extra, missing or incorrect topology still fails. No timeout, tolerance or budget changes.

A regression holds real ResizeObserver deliveries across Undo. It observes the genuinely empty rendered edge list, requires comparison to remain pending, then releases measurement and requires the complete original topology. The hold is always released in cleanup. Native Windows and two-repeat Linux checks use the shared gate budget; busy (75) is not a test pass. The final branch Nightly and native before/after results are linked in PR #403.
