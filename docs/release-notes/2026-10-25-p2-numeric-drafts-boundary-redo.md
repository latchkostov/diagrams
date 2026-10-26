## Numeric drafts and boundary-copy Redo

Clearing an inspector size field and pressing Enter or leaving it now keeps the stored size instead of
resetting it to the minimum. Empty and whitespace-only drafts are covered above the minimum for size
and slider inputs, including a subsequent valid replacement. Boundary and zone radius fields also
have browser coverage for clearing a nonzero radius.

Alt-drag boundary-copy coverage now compares the entire saved diagram before Undo and after Redo,
including copied ids, membership, nested boundaries, positions and explicit corner radii.

No parity goldens changed.
