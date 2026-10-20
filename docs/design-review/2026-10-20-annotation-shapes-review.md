## Annotation shape creation and readability

The existing quick-add and inspector surfaces remain unchanged. Shape naming now uses the
same buffered typing handoff as node naming, with the caret after captured text. Canvas and
connected creation each remain one undoable action even when naming outlasts history's debounce.

Every annotation insertion shares refusal rules and a recovery message at the annotation
limit. Refusal leaves the document, connection list and history untouched. Clones preserve
typography and recompute boundary membership at their destination.

Solid silhouettes use the quiet shape fill: labels retain their usual ink and exceed 4.5:1
contrast in both themes for all seven preset colours. Shape-specific padding wins over the
base padding, with browser checks for multiline triangles, trapezoids and braces. The Lab's
annotation-shapes fixture exposes all outlines and the solid-shape colour matrix for inspection.

## Chrome and interaction review

No additional controls, menu levels or global modes. Keyboard naming retains captured spaces,
keeps subsequent characters at the end, commits with the established editing keys, and restores
the complete named shape with Redo. Annotation limits and invalid geometry are recoverable
refusals rather than documents that cannot reopen.

Shape geometry and inline text editing stay eager. Picker glyphs and secondary inspector
panels load on use, with fixed glyph space and a render notification when a panel arrives.
This preserves export readiness and text focus while keeping all three bundle budgets unchanged.
