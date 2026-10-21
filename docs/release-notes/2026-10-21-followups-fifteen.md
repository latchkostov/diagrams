## Mermaid labels, Forge focus and relay progress

Classic Mermaid labels retain literal apostrophes and trailing backslashes before semicolon-separated
statements. YAML apostrophe doubling and backslash escapes apply only inside extended `@{…}` shape
attributes. Regressions cover classic node and connection labels through import/export/import; the
existing extended-label YAML interoperability and round-trip tests remain intact.

Forge settings preserve the focused size or theme option when replacement-file validation completes.
The completion respects focus outside the frame. Thumbnail coverage now independently asserts
48 nodes, 72 connections and 12 boundaries, exact SVG allocation, and no unreadable labels.

Relay admission retains acknowledged epoch progress when a changed chain supersedes an unfinished
transfer after a previous round completed. A separate regression covers replacement in the middle of
a split epoch, including stale acknowledgements and every remaining roster entry.

PNG and SVG export coverage verifies both connection endpoints against the captured outlines while
geometry and forced handle measurement are deferred. Cancellation during the geometry wait must
release editing before the download completes, discard that export and allow retry. The observed
trouble cache regression now checks distinct timeout suggestions for two connections sharing a
target and a slower second target, alongside resolver work counts.

Plugin packaging remains deliberately unversioned. The release helper and skill README point to the
canonical commit-tracking policy, including generated changes made by regen and sync.

Already complete on the starting master: extended Mermaid backslash escaping and all remaining
#209/#210 findings in `74630c33` (#213); lazy narration focus, held-capacity playback and narration
Retry in `e9952644` (#215); all thirteen #219 findings in `102cdc35` (#223); the main unversioned
plugin policy in `72d24cfe` (#220); self-host readiness in `4762486a` (#221). These fixes are retained.

Output parity: all 2,897 goldens match, with zero changed, added, missing or stale. No golden was
re-recorded. No new simulation, planning or stencil feature is introduced.
