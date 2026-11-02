## Live and offline viewer headroom

Live's existing static imports now share two compression dictionaries: `LiveSession` for canvas-dependent
code and `live-shared` for the playback engine, model and helpers also used independently. This consolidates
the former simulation, playback-model, live-helpers, playbackInputs, faultWords and playback helper chunks.
Shared number/list formatters keep their own chunks so File dialogs open while Live is downloading.
The dynamic session import also has a 78-byte gzip namespace facade. Optional panels retain their existing
loaders, focus notifications, recovery and export readiness; styles retain their original loading order.

The read-only Interactive HTML viewer uses a narrow canvas port for getters, transient selection and camera
commands. It no longer bundles the editor's document commands, arrangement and layout implementation. The
installed skill viewer is regenerated from the same sources.

Production measurements on Node 24.22.0, gzip level 9 (ZIP uses the existing deterministic packager):

| Output                 |    Before |     After |    Freed |
| ---------------------- | --------: | --------: | -------: |
| Live beyond the canvas | 127,587 B | 122,636 B |  4,951 B |
| Canvas first view      | 361,701 B | 361,375 B |    326 B |
| Startup JavaScript     | 160,796 B | 160,693 B |    103 B |
| Fresh skill ZIP        | 824,429 B | 805,488 B | 18,941 B |

All budgets, reserves and the ZIP cap are unchanged. No output golden is updated: this changes packaging,
not diagram, simulation, planning or export behavior. No new lazy surface or showcase is introduced.

A broad module regrouping was rejected because it pulled playback into startup. A second grouping was
rejected because it coupled Your diagrams to the canvas. Holding the retained runtime exposed a formatter
dependency that blocked the image-export dialog; keeping those formatters separate fixes that boundary.
The retained split reuses the canvas plugin's
independent-consumer graph; build tests protect those boundaries and both regressions fail with the
corresponding optimization temporarily removed.
