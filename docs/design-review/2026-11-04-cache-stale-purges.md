## PR 4 WIP: copy and model consistency review

The owner's correction preserves the small example's workload, four-thread
origin, 20,000-product tail, duration and every chip threshold. Hard purge
narration must explain minutes of refill and a queue that remains behind at run
end. A high aggregate hit percentage is not evidence that the origin recovered:
the hot launch page can mask the cold product tail. The run-end lesson now checks
the origin's remaining queue before claiming a hit-ratio recovery.

`itemFetches` is a maximum across tracked items. The chip label now states that
scope; it does not imply a launch-page selector the contract lacks. This exposes
additional product-fetch failures in four hard-purge seeds instead of hiding them.
The existing two comparisons retain their numerical assertions.

The new stale controls remain inside the rule's expiry disclosure; purges remain
in the node's Fault menu and simulation step editor. No toolbar control was added.
A designer agent reviewed the English callout captures and the purge editor.
Targeted production tests cover Apply/Undo for both ladder steps, stale-policy
Undo, setup-only rules and special rule IDs. Arabic and en-XA stale selectors
fit at 375 and 1280 pixels and support ArrowDown/Enter. The narrow canvas is
fitted before clicking; no camera assertion was weakened. The supplied captures
show no horizontal overflow or overlap. This does not certify a complete screen
reader traversal or every localized purge-editor layout.

The first Black Friday candidate sent 80% of traffic into the cold product tail
and 20% into Search. Its 8,400–9,050-request first backlog kept growing after the
soft purge, and all five p95 chips failed at 20,050 ms. That mix was not specified
by the design and was rejected. The retained doorbuster peak uses 90% doorbuster,
8% other products and 2% search, with stale windows on every storing rule before
the soft deploy. Five-seed tests pass every unchanged chip. The small example
continues to teach the minutes-long cold-tail overload. No sizing or thresholds
were changed.

The source review caught and corrected purge-scope attribution, unrestricted rule
ID collisions and missing simulation-only rules in the step editor. Cold-cache
lessons now use the purged tail and observed origin, with a request-rate lower
bound before mentioning minutes. A partial one-item purge cannot borrow the
size of an untouched large rule. Purge mode and Show as replace opaque labels.
