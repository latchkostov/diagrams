## Live view and slow motion under the camera policy (2026-10-18)

Folding Live view and slow motion into the camera controller kept today's geometry, paddings and durations
(`docs/release-notes/2026-10-18-camera-live.md`). No Live spec assertion and no parity golden moved. The
changes below come from deciding by the policy table instead of separate timers. Each one is a row in
`src/canvas/camera/panePolicy.ts`.

### Slow motion keeps its camera (W1, W3, W7)

- If the side panel opens or closes during slow motion, only slow motion replans its take. Before, Live's own
  panel refit fired 320 ms later and replaced slow motion's 180 ms replan with a fit of the whole diagram.
- A note that arrives during slow motion only records its focus. It no longer takes the view from the replay.
- Turning presentation on or off, or full screen, during slow motion replans the take for the new pane. The
  canvas no longer fits the whole diagram in between.

### What gives the view up during slow motion (W6)

Before, following stopped only on a press or wheel on the pane. Now Shift+0, Fit (Shift+1) and Shift+2 stop
it too, because they make the view the user's (or Fit's), as everywhere else. A new take (Replay, presenting,
a panel or a recording) takes the view back, as before.

### One refit per change of room (L3)

- Opening the side panel folds the Inspector. Before, that ran two refits, Live's panel refit and its dock
  refit. Now it runs one, which lands on the same view.
- Before, if the trace card opened while the side panel was open, closing the card later never refitted
  (a stale flag). The policy remembers the room, so that close now refits beside or without the card.

### Timing

Live's refits, a note's close-up, a node Live added, and slow motion's plans now run as soon as the pane has
settled on two rendered frames. That's usually two frames, where before it was 120–320 ms. A node Live added is
also measured before its fit. Follow pans wait for any camera move in flight (one move at a time) and for pane
work still waiting, so a paused replay's view holds while its pane settles.

### Leaving live view while presenting (F4)

Pressing L during a presented replay ends slow motion and fits the whole diagram for the presentation. After
that, full screen refits it as usual. Before this fix round, the replay's close-up stayed.

### Unchanged on purpose

- A manual Live view whose pane changes keeps the zoom. It pans the selection and its connections into view
  only when they're covered, and it never recentres the diagram.
- Live's own work never waited for menus, and it still doesn't. The canvas's pane work in live view still
  waits for them.
- A node Live added comes into view whoever owns the view, as before.
