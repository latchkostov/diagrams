## Buffered names finish outside React effects

A search result can arrive during React's effect flush. Delivering a buffered naming completion immediately then calls a synchronous document commit inside that lifecycle. The handoff now runs in a microtask and keeps the destination capture's identity, so cancellation cannot send an old name to a newer field.

A DOM integration regression catches React's lifecycle error with the synchronous handoff; a separate cancellation regression protects the destination. No output golden, timeout or expected UI value changes.
