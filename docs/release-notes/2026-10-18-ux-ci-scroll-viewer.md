## Latency details, gallery playback and the offline viewer

Latency details keep Home, End, Page Up and Page Down inside their focused reading region.
Each key moves immediately, so a pending native Home scroll cannot swallow the next End.
Wheel scrolling and Shift+Tab back to the node remain available, including short embeds.

Entering Live starts the first saved simulation only for an untouched gallery example.
An edited example starts free play. This prevents an unrelated saved narration from taking
the camera away from the whole-diagram fit; explicitly selecting a simulation still gives
its narration ownership of the camera.

The offline viewer reuses the stencil catalog's English text instead of also bundling the
translation lookup tables. It also excludes the simulation editor's lazy loading wrapper.
The deterministic skill zip falls from 811,058 bytes after synchronization to 802,658 bytes,
leaving 7,342 bytes under the unchanged 810,000-byte budget. The branch added 3,005 compressed
bytes relative to synchronized master: 3,004 in the viewer and one in the generated app module.
The final viewer is smaller than master's; no download budget was raised.

## Output parity

No output golden is intentionally changed. The stencil text check compares names, descriptions,
subtitles and vendor names against the app's English output, byte for byte.

## Validation

All 11,380 unit tests pass (four skipped). Output parity passes all 2,530 goldens unchanged,
including 91 Linux browser cases. The four focused production-browser checks pass on Windows.
Temporarily removing the viewer lookup swap fails its bundle test; removing the modified-example
guard fails the Inspector regression. The latency regression passes without the paging fix on
Windows; the original CI trace reproduces its Linux-only failure after Home followed by End.

The requested three-spec Linux repetitions could not acquire the shared worker budget (exit 75:
another full gate owns all 12 slots). No running holder or lock was changed.
