## Camera controller: review follow-ups

From the PR #150 review, still open after its fix round:

- **E2E tests of the changed pane-reveal geometry.** Add two tests. In the first, opening the Inspector reveals a
  selection that the minimap covers, without zooming. In the second, opening it leaves a selection that is
  uncovered but inside the old 40–72 px margin where it is. Both should assert the node and overlay rectangles and
  the viewport transform after `waitForCameraIdle`. The unit tests mock `revealTarget`. The one changed golden
  (`measured-order-capacity`) covers the overlay case only indirectly.
- **A foreign move that pre-empts ours before its first frame.** React Flow reports a move start without an event
  for both our moves and other writers' (Live, slow motion, the minimap, its zoom buttons). The controller matches
  each start to the oldest of its own moves still waiting to start. It forgets a move that hasn't started two frames
  after it was issued. If another writer's move starts in that same frame and pre-empts ours, its start is taken
  for ours. Our transition then stays in flight until its promise resolves, which it never will. The window is one
  frame. The zoom buttons avoid it by reporting through the controller, and Live and slow motion close it once
  they are folded in (`docs/backlog/2026-10-17-camera-live-slowmo.md`). The interleaving model doesn't generate
  this case.
