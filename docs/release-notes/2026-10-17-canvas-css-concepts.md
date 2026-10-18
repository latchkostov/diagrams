## Canvas CSS organized by concept

Internal refactor with no user-visible change. The 3,906-line canvas stylesheet becomes an import index
and twelve concept files: React Flow, nodes, boundaries, edges, palette, overlays, context menu,
Inspector, dialogs, onboarding, annotations and quick-add. Component code, class names, DOM, camera
behaviour and lazy Live/Checks stylesheet entry points are unchanged.

The cascade checker retains fingerprints of all 563 original rule blocks, including declarations,
strings and media/container contexts, and checks every reordered relationship against the authored
element/class graph and React Flow's fixed roles. Vitest also rejects declaration/context drift and
unsafe reordered overrides. The context-menu contrast test changes only its file path.

No parity goldens changed, added, removed or re-recorded. Validation and the file map are in the
[design review](../design-review/2026-10-17-canvas-css-concepts.md).
