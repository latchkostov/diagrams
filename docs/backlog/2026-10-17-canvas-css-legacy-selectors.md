## Audit legacy canvas selectors before removing them

The canvas CSS extraction found four legacy selectors without a current class producer:
.insp-meta, .insp-relation, .start-theme and .start-section.

Their declarations are preserved in the concept split. Confirm that no imperative renderer or
downstream consumer relies on them before a separate cleanup. The cascade checker guards against
silently introducing a producer while its refactor proof treats these selectors as inactive.
