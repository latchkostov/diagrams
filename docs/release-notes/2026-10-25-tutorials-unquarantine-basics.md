## Arrange, Insert on an edge and Dependencies part 2 return

The three lessons are available again from tutorial cards, search, suggestions and direct links.
Arrange recognizes aligned services even when their connecting edges are selected. Insert on an edge
reuses a gateway added after the app and retains existing connection halves instead of duplicating them;
Skip removes any remaining direct app-to-API connection. Dependencies part 2 shows Dependencies when
Skip or Continue reconstructs its prerequisite, so its Config connection can be selected.

Regression coverage includes both partial connection directions, a gateway with both halves connected,
node-only alignment minimums, mixed selections and hidden Dependencies on Skip and Continue. The existing
setting-lock and Outbox compensation acknowledgment regressions remain enabled. No copy or parity golden
changes are intended; the existing goldens remain unchanged. Design studies remain quarantined.
