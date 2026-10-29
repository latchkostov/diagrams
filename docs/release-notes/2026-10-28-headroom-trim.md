## Live and offline viewer headroom

Compact internal Live controller, playback and renderer members using JavaScript private names, and
omit pixel-readback and frame-count test hooks from ordinary production builds. The readable source
names and public APIs stay intact. No modules gain a lazy boundary.

The read-only HTML viewer excludes the shared planning barrel's admission and model-upgrade editors,
the connected-node plus, connection port feedback and connection preview. These editing controls
cannot open in a read-only file; playback, planning readouts and exports keep their behavior. The
generated skill viewer is refreshed. Their unreachable dependencies also disappear: planning
migration and admission-field bindings, plus chip placement and grow-edge comparisons. The Live
module set and chunk-loading boundaries are unchanged.

| Measurement                  |    Before |     After |   Change |
| ---------------------------- | --------: | --------: | -------: |
| Live beyond the canvas, gzip | 128,838 B | 127,251 B | −1,587 B |
| Canvas first view, gzip      | 358,670 B | 358,692 B |    +22 B |
| Skill ZIP                    | 828,808 B | 821,213 B | −7,595 B |

Measurements use the production bundle closure and gzip level 9, matching the reserve tests. Live
has 1,605 B under its unchanged 128,856 B reserve limit; the ZIP has 7,643 B under its unchanged
828,856 B reserve limit. The canvas's small change is chunk-hash/import-name churn; no code moved
into its first view. All budgets and reserves remain fixed. No parity golden files are updated.
Full parity passed: 3,178 goldens, 0 changed, 0 added, 0 missing and 0 stale, including all 110 Linux
browser tests and 1,873 Node tests.

Regression guards cover minified private members, omitted production test hooks and the five viewer
exclusions. Both new guards failed with the implementation temporarily restored to the base revision.

The full editor hook remains in the viewer: replacing its read/selection/document contracts is a
larger change than this trim needs. Deferring menus, narration or drill code was also unnecessary.
