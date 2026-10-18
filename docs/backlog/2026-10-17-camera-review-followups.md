## Camera controller: review follow-ups

From the PR #150 review, still open after its fix round:

- **E2E tests of the changed pane-reveal geometry.** Add two tests. In the first, opening the Inspector reveals a
  selection that the minimap covers, without zooming. In the second, opening it leaves a selection that is
  uncovered but inside the old 40–72 px margin where it is. Both should assert the node and overlay rectangles and
  the viewport transform after `waitForCameraIdle`. The unit tests mock `revealTarget`. The one changed golden
  (`measured-order-capacity`) covers the overlay case only indirectly.
