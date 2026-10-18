## Scope

Separate independent Live popover focus notifications from exclusive canvas surfaces, and strengthen browser coverage for presentation-note focus, paused slow-motion language changes, and hidden-dependency Undo.

## Findings

The designer review found no UX concerns, new product chrome or changed behavior. The language buttons belong only to the Lab fixture. Existing presentation focus, keyboard recovery, translated explanatory text, and Undo behavior are better protected.

The changes support keyboard access, presentation usability, predictable Undo, and the existing language contract. No simplification or follow-up is required.

## Regression proof

- Adding Live back to the exclusive surface union fails the type contract.
- Disabling NoteCallout's narration focus dispatch fails the real Continue focus assertion.
- Removing the slow-card memo's note dependency leaves English on the mounted card and fails the locale-switch regression.
- Suppressing Undo fails the original-label assertion even with the journal assertions temporarily omitted. Treating a hidden edge as still waiting separately fails the journal's fallback-completion assertion.

All deliberate mutations were restored. The presentation test installs its fake clock before navigation so Live's animation loop advances under that clock.
