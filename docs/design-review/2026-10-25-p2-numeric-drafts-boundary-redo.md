## UX review

Empty numeric drafts preserve the stored size until a valid replacement is committed. Enter or blur
restores the displayed stored value, matching the existing radius slider behavior. No controls or
chrome are added.

Redo must restore the exact boundary copy the user placed, including its subtree and corner radii.
The browser regression retains the original remapping assertions and adds whole-document equality
against the saved copy, so a different valid placement cannot pass.

## Scope

Keep the existing slider empty-draft guard and history implementation. Fix the size field's missing
guard rather than changing numeric clamping for valid input. Verification is limited to the numeric
commit unit spec and zones/boundaries browser spec for this fix round.
