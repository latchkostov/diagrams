## Slow motion readouts between playback updates

The journey clock, caption and trace highlights keep their last published values while playback
advances between UI updates, including when changing speed triggers a render. Playback still uses
the current script clock. Paused snapshots remain stable.

Machine transitions now require the payload for their target state, including compatible optional
fields across every source variant, and replay browser adapters
remain behind the existing lazy download. No output goldens were changed. This fix round runs
targeted verification; full parity and the full suite are left to PR CI.
