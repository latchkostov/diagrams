## Scope and keyboard behavior

The fixes preserve the existing Config inspector and dialog surfaces. No controls, copy, menus,
or default diagram output are added. Distinct inspector children preserve their local identity;
a dialog's real close restores its original opener through the existing interaction controller.

The room-dialog development regression covers opening from File, Cancel, the journal's focus cause,
and continuing through the unconfigured-room menu. The StrictMode unit guard checks both direct
focus restoration and a controller callback, background inertness, and the absence of a phantom
close during effect replay.

## Decisions

Keep the existing focus, native-select value, camera, playback and offline-export assertions.
Do not raise timeouts, add retries, relax production CSP, or change simulation code to accommodate
unreproduced native failures. Record their exact evidence in the dated triage fragment and flake
ledger so platform owners can investigate the remaining transitions.
