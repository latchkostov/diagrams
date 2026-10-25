## Toast actions stay under the pointer

Toasts stay in place while hovered, focused or pressed, so Undo remains where the gesture
started even when canvas bars return. New notifications wait until the interaction finishes;
the existing latest-notification policy is preserved. Expiry pauses during the interaction.
Toasts keep their live-region announcements and keyboard actions, with no entrance animation
when reduced motion is requested.

Recording Undo keeps the discarded clip available throughout a hover or keyboard interaction;
its URL is released when the toast actually goes, unless Undo restored the recording.

No output goldens change. This fixes editor notifications, without changing diagram exports
or simulation output.
