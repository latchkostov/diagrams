## Confluence Forge review fixes

The existing attachment picker, Upload/Replace actions and Save remain the complete configuration
surface. No new chrome is needed. Loading temporarily prevents concurrent changes, then returns
keyboard focus to the initiating control unless the reader moved elsewhere. Cancel remains available.
Long attachment names fit the form at 320 px and at a 160 px effective viewport for enlarged content.

Host themes flow through the same React settings as the canvas, live renderer and caption contrast.
Playback remains explicit, and changing themes does not restart it. Oversized attachments show the
existing actionable size error before downloading. Saved simulation selection is checked against
the viewer's loaded event, retaining validation at the viewer boundary.

Rejected approaches: DOM-only theme overrides leave renderers stale; downloading the current version
after checking metadata leaves a replacement race; source-string substitutions make packaging depend
on canvas formatting. Typed attribution keeps the policy at the viewer boundary without adding UI.
