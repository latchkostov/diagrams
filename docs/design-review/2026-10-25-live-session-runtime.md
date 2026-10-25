## Candidate A implementation UX review

The registered adapter owns the downloaded hooks; the shell owns pending intent and its
checkpoint. No toolbar control or new mode is introduced. Ordinary Live remains interactive
before replay intent. The existing bar notice explains trace loading and the existing
slow-motion loading chip explains the held engine and Escape. The trace retains its
requested node/root without constructing or dimming an incorrect path.

Pending semantics are explicit machine transitions: last request wins before handoff,
one preserved checkpoint, failure retains the request/hold for Retry, cancellation retires
it, and readiness never resurrects an exited request. A higher priority modal queues
handoff. Image/record dialogs consume the requested output and await capture; model
export stays independent. Download resolution alone never takes the camera.

A designer-agent source review caught and corrected three lifecycle issues: generation
cancellation is restricted to shell-pending work (the loaded runtime retains its existing
drop behavior); focused controls retain Enter, including Retry and replay-card buttons;
and failed-download Retry is dismissed on the last consumer's unmount. Loading uses the
existing notice inside the bar, with its established positioning, rather than an unplaced
HUD chip. Browser regressions cover the keyboard, camera and recording paths.

Worker/main, reduced motion and paused/live combinations retain their replay framing and
return to their prior viewport and play state. No visual or model-output change is intended;
parity goldens must remain unchanged. Candidate B/C/D work and extra chrome are out of scope.

## Self-contained viewer

The website and exported viewer use the same registered adapter and replay controller.
The offline browser regression opens the exported file, replays, activates Pause by keyboard,
exits replay and checks zero requests and CSP violations. A separate eager viewer adapter
was investigated to meet the fixed ZIP cap, then removed after master's independent viewer
trim made it unnecessary. This keeps one lifecycle implementation across delivery paths.
The same native-control rule applies while armed: keyboard Send one now still activates
its focused button. Temporarily removing that guard makes its browser regression fail.
