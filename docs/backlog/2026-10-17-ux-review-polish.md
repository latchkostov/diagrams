## Remaining polish from the 2026-10-17 UX review

- Reset “Recovery link copied” after a bounded feedback interval, using the same behavior as other copy buttons.
- Suppress the Live hover explanation for the element already shown in the open Inspector.
- Consider placing the legacy planning-model upgrade explanation under Advanced on public examples; keep model
  upgrade behavior and access intact.
- Before the next node-menu addition, fold Edit subtitle into Rename. The current menu already has 12 items;
  Subtitle is one Tab after Label in the Inspector.

The optional 22vw default Inspector slope was not adopted: the owner requested the existing large-screen default,
and width should remain independent of selection. The batch retains the 26.5vw slope with its 640 px default cap.
Connection failure, invalid-link wording, unsaved status, sheet caps, route readability and export progress are
handled by follow-ups 4, rather than being deferred here.
