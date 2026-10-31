## Orchestrator decision: Control at drag start on macOS

`edge-shaping.spec.ts`'s Control-drag case fails on macOS in both baseline Nightlies, 41167179188 and 41168472337. The macOS trace shows the first unmodified drag creating its preview and snapped route. On the second gesture, Control is already held at pointer-down; the interaction state becomes `menu-open`, and the edge's application context menu appears instead of a route preview. This is distinct from geometry rounding or a slow camera.

[Apple documents Control-click as secondary click](https://support.apple.com/en-gb/guide/mac-help/mh35853/mac). The native event reaches the application's registered context-menu behavior. Increasing a wait cannot turn that gesture into a primary drag. The Meta case already exercises the alternative modifier.

Proposed decision: advertise and test Command-drag on macOS and Control-drag elsewhere, while retaining secondary-click coverage on macOS. If Control must also bypass snapping on macOS, define whether it may be pressed after the primary drag begins or must suppress the normal secondary-click behavior at pointer-down; that needs an explicit product rule before changing the gesture or oracle.

The rule was requested during round two. Pending that decision, this branch leaves both modifier cases and their exact off-grid assertion enabled. Nothing is skipped, quarantined or relabelled as passing. Report this conflict and the final Nightly result to the orchestrator.
