## Cache merge UX review

The merge adds no controls and preserves the existing contextual coalescing action, herd/stampede priority, and progressive disclosure. Expected and Inputs retain real fetch duration. Recent-window hit/offload readouts remain separate from rule totals since restart and the latency baseline since restart or the last fault.

Compact and full summaries and both latency scopes retain their rendered wording through shared selector messages. The readout tests cover the restart/fault transition and compact display. Coalesced waiters remain misses for response-latency purposes, while one successful origin reply fills once. The public stampede example remains the existing feature showcase; this merge adds no new simulation feature.

The fixed locale limits pass with one byte of Arabic-core headroom. The existing [core locale reserve follow-up](../backlog/2026-11-03-core-locale-headroom.md) covers further catalog growth; keep its measured trim separate and retain the budget.
