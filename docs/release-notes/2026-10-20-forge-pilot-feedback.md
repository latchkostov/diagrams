## Confluence pilot feedback

The Forge app now lists and uploads the native `.diagram.json` export, while retaining support for
older `.livediagram.json` attachments. Other JSON files remain excluded. The picker and validation
share one suffix rule.

Maximise opens the same resource in Forge's supported `max` modal, passing only attachment references,
simulation and theme settings. It starts still until Play, fills the modal and closes with Esc or Close
diagram. Inline playback pauses and closing returns focus to Maximise. No browser Fullscreen or egress
permission is needed; no viewer action requires egress. Existing local recording and sequence exports
remain available under Forge's download and clipboard permissions.

Automatic height uses the viewer's measured fit-to-width report, bounded to 480–900 px. The lower bound
keeps diagrams readable, and the upper bound limits page takeover. Fixed heights stay unchanged.
Forge's document auto-resizer is enabled by omitting macro viewportSize; no nonexistent view.resize API
or resize-to-current-height feedback is used. Help text explains the defaults. Forge offers block,
inline and bodied manifest layouts, but no wide/full-width value; the default stays block.

The only intended parity change is `node/i18n/catalogs.json`: four new `viewerForge` help/action/error
keys change the catalog message counts and viewerForge area fingerprints. Updated filename messages
also change that area's fingerprint. Existing locales have no viewerForge translations and continue
to use English fallback, as documented by the i18n tooling. Diagram, simulation and rendering outputs
stay unchanged.

## Verification follow-up

The full gate caught a forbidden picker-enumeration assertion in the new browser test; it now checks
exact text, option count and selection of both attachment IDs through `data-testid`. It also exposed a
wall-clock dependency in the existing public-example evidence test under coverage and CPU contention.
That semantic check now injects a frozen clock while preserving every completeness and loss assertion;
the evidence deadline tests retain their moving fake clocks. No runtime or diagram output changes.
