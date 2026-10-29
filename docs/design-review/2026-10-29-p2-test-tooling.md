## Export, Nightly and survey tooling review

This batch adds regression coverage and corrects measurement/workflow tooling. It adds no controls,
UI text or canvas behavior. Chip readiness is checked against a rendered React subscriber, including
capture and natural-card restoration; PNG checks inspect the actual decoder input after embedding.
The chrome budget and existing export appearance remain unchanged.

Inactive-chip decoration is deliberately deferred. Skipping that work changes the shared baseline
fault-ink lifecycle; its existing backlog calls for mode-transition and capture restoration coverage.
The narrower readiness and PNG resource tests do not establish that contract.
