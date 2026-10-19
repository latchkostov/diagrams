## Live drill review fixes

Run results count dropped messages as loss, matching expectation metrics and Checks evidence. Recovered dead-letter transfers are retained traffic: the 3PL outage and DLQ redrive example now ends with “No messages lost”. Down-node advice keeps Restore when an unrelated slowdown or failure is active.

Live outage membership uses cached descendant ranges and preserves the first active outage when boundaries overlap. Node fault labels use one translated lookup map instead of scanning every fault for each node. Dense fault timelines account for global latency resets in their work limit, and shared latency-window metadata is immutable.

Escape returns from both loading and loaded simulations panels to their opener. Overflowing latency summaries support pointer and keyboard scrolling, including embeds and presentation; compact waiting/work percentages exclude animation travel. No controls were added.

Before sync, output parity checked all 2,369 committed goldens unchanged. After merging upstream, four goldens were regenerated intentionally:

- `node/i18n/catalogs.json` combines this branch's existing UX strings with upstream's 15 new collaboration/share keys and updated translations. Message/fallback counts and collaboration/share hashes reflect that merge.
- `node/sim/recommendations-feature-store/slow-features.json`: both fault markers name “Feature server” instead of its `feature-server` ID.
- `node/sim/observability-pipeline/loki-outage.json`: take-down and restore markers name “Loki write path” instead of its `loki` ID.
- `node/sim/hybrid-enterprise-network/leicester-fibre-cut.json`: both connectivity markers name “Fibre underlay” instead of its `leicester-fibre` ID.

The three simulation goldens apply the branch's existing human-readable fault labels to newly merged examples; only the six marker labels change. Simulation counters, layout, render and export outputs are unchanged.
