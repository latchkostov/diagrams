## Zone and boundary final UX review

The contributor's design stays intact: radius customization remains in the inspector, with no new global controls or chrome. Pointer adjustments and focused keyboard edits each undo as one action even when paused. Typed radius commits remain separate adjustments. Boundary and zone meaning, appearance and conversion affordances stay consistent.

Arrange availability now reflects what actually moves: selected descendants travel with their outermost selected boundary, so Align needs two independent operands and Distribute needs three. Tidy up retains its node-based availability. Imported boundary IDs cannot make an unselected boundary move, and snapping a populated boundary preserves all descendant offsets while using stationary external targets.

Reviewed keyboard, pointer, Undo, menu/inspector parity and disabled/hidden arrangement controls against the existing UX principles. Production browser regressions exercise these behaviors. The existing public showcase continues demonstrating rounded boundaries and a zone; its draw.io round-trip now preserves those choices.
