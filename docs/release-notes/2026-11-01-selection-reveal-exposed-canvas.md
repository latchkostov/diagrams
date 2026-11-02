## Keep selected nodes above the phone's Properties sheet

Selecting a node now reveals it inside the exposed canvas, clear of the phone's bottom Properties sheet and an overlapping side dock. Previously the reveal could leave it behind the sheet, where frame clipping hid it and its keyboard focus was lost. Arrow keys after selection can now edit the selected node.

The reveal preserves zoom and keeps the card's badge space inside the Focus/Follow frame when avoiding floating controls. Oversized selections retain their established vertical centering fallback. There are no new controls or copy changes. Full output parity passes with all 3,178 goldens unchanged; none is re-recorded. Final native verification is reported in the round-eight PR.
