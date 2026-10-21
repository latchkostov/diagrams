## Scope and chrome

Reviewed the existing one-diagram settings flow and maximised viewer against the UX
principles. No controls are added. Choose, Insert and Update remain the single primary
action on their respective surfaces; Options stays folded by default. Bounded previews
keep the existing 140 px card and readable labels for small diagrams.

## Keyboard and recovery

Escape backs out one level in Maximise, retaining playback while closing More or Inputs.
Forge automatic Escape dismissal is disabled so it cannot bypass viewer ownership.
Inline playback pauses when Maximise opens and requires an explicit resume afterward.
Async completion respects navigation to another control, the parent frame, and leaving
then returning to the iframe. A rejected Cancel preserves active reads and restores the
open panel's readiness. Error announcements retain assertive live-region semantics.

Partial upload success is explained where settings fail, including Cancel's persistent
effect and the attachment-history recovery path. Invalid replacements preserve the
accepted file and its checkpoint. The dark hover fallback uses dark text on a light blue
background; host design tokens continue to override both colours.

## Review decisions

Kept a small configuration lifecycle and a checkpoint on each accepted selection rather
than restarting reads after failed Cancel or reuploading an already saved file. Theme
isolation occurs only in Forge packaging, leaving main-app and standalone-viewer theme
contracts intact. No outside endpoint or manifest permission is added.
