## Faster zoom and settled frame detail

Zooming in keeps each node's fitted icon and name in place while the canvas scales them. Zooming out advances identity sizing in readable steps. After four quiet animation frames, exact sizing and name fitting return. This works in editing, presentation, embeds and the offline viewer, without adding controls.

Frame detail now traverses the canvas once, batches geometry reads and style writes, indexes pins, incident connections and label collisions, and ignores unchanged camera notifications. Node cards contain their layout and style work. Operation-count tests bound reads, writes, layout barriers and growth, and export capture explicitly restores cached identity afterward.

Viewport culling was deferred because unmounting nodes would expand the selection, keyboard navigation, Focus pin and export lifecycle changes. The existing identity layer remains responsible for every node.

All 3,178 parity goldens are unchanged: no output was re-recorded. Production canvas first-view and startup JavaScript remain smaller than the starting revision. Budgets and reserves are unchanged.
