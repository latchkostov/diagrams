## Deferred menu keyboard recovery and editing

Failed menu downloads release keyboard capture so Tab can reach Retry and Enter can activate it,
while input queued before the failure remains available after recovery. Pending edits to a new node's
Subtitle now save to that field, including when Enter finishes before its inspector downloads.
Menu search replay preserves word deletion, select-all and caret selection instead of discarding
modified editing keys.

Held-download browser tests compare all three fixes with eager menus. Naming tests finish with
Enter and Escape while either inspector chunk remains held, verify no late focus theft and undo
the entire creation in one step. No output goldens change.
