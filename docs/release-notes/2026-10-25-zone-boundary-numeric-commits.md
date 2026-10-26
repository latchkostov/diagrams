## Zone and boundary follow-ups from #335

Numeric inspector commits now compare their rounded, clamped result with the stored value.
Recommitting an equivalent radius or size does no document write and adds no Undo step;
committing a displayed integer still updates a stored fractional value.

Regression coverage exercises Alt-drag of a boundary with a nested boundary, a service and a note:
copies receive new IDs and memberships, move together, and Undo/Redo leaves the originals intact.
The existing copy behavior needed no implementation change.

No parity goldens changed. Verification is limited to the targeted tests for this fix round;
full parity and the full suite are left to PR CI.
