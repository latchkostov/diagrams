## Short-window recovery

Recovery feedback stays within the Share dialog's keyboard cycle. Restoring the placement marker during
effect cleanup preserves the existing panel height, so Copy and Close keep their positions when React
replays setup. No control, menu item or persistent chrome is added. Retry still delivers the queued
confirmation and Escape returns to the canvas.

## Development framing

The Confluence test's frame uses the production viewer under the real CSP. Its attachment cookies,
lazy off-screen activation, click-to-play behavior and playback assertions stay intact. Development
React's refresh script is not part of that production embedding contract.

## Decisions

Keep the existing inspector key namespaces and dev console guard. Keep Greek rail fitting open until
the platform's fallback font and hyphenation can be observed; the unchanged cases pass locally on
Windows and in the pinned Linux image. Preserve the original fit assertions and production CSP.
