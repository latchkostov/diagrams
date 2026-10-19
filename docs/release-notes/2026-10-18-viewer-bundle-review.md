## Platform viewer review fixes

The static viewer survives a cached Back/Forward navigation and still tears down on a later real page exit.
It shares Interactive HTML's named zoom/fit buttons and keyboard pan/zoom controls. Live actions now show
accessible feedback and recording Undo; local PNG images and recorded video previews work under the
bundle CSP. Blob permissions are limited to images and media, with scripts, connections and workers unchanged.
Stencil SVGs ship as hashed assets and load only when rendered, reducing startup JavaScript.

Browser regressions cover restoration, keyboard controls, PNG export, recording preview/discard/Undo,
host free play and saved playback before the canvas mounts, and an immediate startup stop. The production
artifact spec skips development targets before reading build output.

## Output parity

Parity checked all 2,530 goldens: none changed, were added, or went missing. Diagram, simulation and
exported Interactive HTML output are preserved.
The generated skill viewer is refreshed after extracting the shared controls; this is a bundle refresh.
