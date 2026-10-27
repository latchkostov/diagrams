## Remaining toast P2 follow-ups

PR #340's resumed P1 fixes also address R-150fd71dce (shortcuts ownership ordering) and
R-1a8d8cc09b (consumed opener actions).

- R-a044ba1c44: exercise capture's merge-tag expiry through the real history hook, including
  settlement before debounce and an unrelated edit after expiry.
- R-2ffae61335: update progress by notification ID across both shown and waiting dialog
  feedback. A busy notification waiting behind engaged feedback currently misses progress.

These independent follow-ups are outside the two modal-opener fixes.
