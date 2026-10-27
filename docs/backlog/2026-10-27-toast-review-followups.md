## Remaining toast P2 follow-ups

PR #340's resumed P1 fixes also address R-150fd71dce (shortcuts ownership ordering) and
R-1a8d8cc09b (consumed opener actions). The last review round's fixes cover R-a044ba1c44 and
R-72cb0c8ed6 (capture's merge-tag expiry, through the real history hook) and the growing part of
R-50342866c4 (invalidation runs and progress are compacted while the renderer is unavailable).

- R-2ffae61335: update progress by notification ID across both shown and waiting dialog
  feedback. A busy notification waiting behind engaged feedback currently misses progress.
- R-50342866c4, remainder: while the renderer download is stalled or failed, a notification that
  is dismissed or replaced stays queued until it loads, so its `onDismiss` (a recording's URL
  revocation) waits too. The queue now grows only with notifications, not with canvas snapshots.
  Releasing them early needs the store's replacement rules (page, dialog slot, task) before the
  runtime exists, including a dialog that closes before the replay.

These independent follow-ups are outside the P1 fixes.
