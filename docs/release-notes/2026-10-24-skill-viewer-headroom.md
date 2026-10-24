## Skill viewer download headroom (PR #286)

The offline skill ZIP shrinks from **835,830 to 831,812 bytes**, saving 4,018 bytes and leaving
3,188 bytes under the unchanged 835,000-byte cap. The Interactive HTML template shrinks from
1,914,913 to 1,901,832 bytes. The platform viewer uses the same exclusions.

The viewers no longer bundle the editor's fix callout or fix-authoring hook. Diagram synchronization
is extracted unchanged so playback keeps its existing lifecycle. Shedding simulation, badges and
readouts remain available. No parity goldens change in this fix; the PR's existing inventory remains
the only intended output changes.

Bundle inspection used Vite's emitted module inventory and `renderedLength` (module contributions
before final minification, not individual compressed sizes):

| Module                         | Interactive HTML before | Platform before | After, both viewers                           |
| ------------------------------ | ----------------------: | --------------: | --------------------------------------------- |
| `live/session/useLiveFixes.ts` |                 7,581 B |         7,402 B | Excluded; synchronization retained separately |
| `live/TroubleCallout.tsx`      |                 5,485 B |         5,351 B | Excluded                                      |
| `live/threadFixes.ts`          |                 4,488 B |         4,350 B | Excluded                                      |

The PR's new `sim/shedQueue.ts` contributes 2,250 B to Interactive HTML, alongside changes to the
existing engine, admission/defaults and live readouts. Shedding Inspector fields were already absent,
as was the dynamically loaded resilience fix planner. Tutorial UI was already excluded outside
dev/e2e; its dependency-free `sandbox.ts` identifier is shared with diagram IO and remains (142 B).
Build guards and both viewer regression tests now enforce these boundaries.

Rejected raising the cap, changing compression or removing rendered simulation behavior: the excess
was editor code that viewers cannot use. Both viewer regressions fail with the original build swaps;
the original ZIP test also reproduces the reported 835,830-byte failure.
