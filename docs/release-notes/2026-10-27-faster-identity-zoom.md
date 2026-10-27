## Faster zoom and settled frame detail

Zooming in keeps each node's fitted icon and name in place while the canvas scales them. Zooming out advances identity sizing in readable steps. After four quiet animation frames, exact sizing and name fitting return. This works in editing, presentation, embeds and the offline viewer, without adding controls.

Frame detail now traverses the canvas once, batches geometry reads and style writes, indexes pins, incident connections and label collisions, and ignores unchanged camera notifications. Node cards contain their layout and style work. Operation-count tests bound reads, writes, layout barriers and growth, and export capture explicitly restores cached identity afterward.

Viewport culling was deferred because unmounting nodes would expand the selection, keyboard navigation, Focus pin and export lifecycle changes. The existing identity layer remains responsible for every node.

All 3,178 parity goldens are unchanged: no output was re-recorded. The production canvas first view is smaller than the starting revision; its eager view-label helper no longer pulls in lazy text-detail code. Budgets and reserves are unchanged.

An isolated sequential quick browser comparison (CPU throttle 2, one sample per workload) measured zoom frame P90 at 100/500 nodes changing from 50/200ms to 33.3/166.7ms. First selection changed from 137.5/337.8ms to 124.2/294ms, and pan task time per step from 9.92/39.51ms to 10.03/32.52ms. These measurements do not change benchmark baselines. Manual zoom-button/key animations share the gesture optimization; automatic fits retain exact sizing.
