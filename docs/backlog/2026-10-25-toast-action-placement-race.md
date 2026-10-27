## Toast actions move between hit testing and pointer dispatch

Resolved by PR #340: engaged toasts retain their placement and resource ownership; history Undo
actions bind to unique entry IDs and become inert when stale. The unchanged routing and recording
assertions pass, and the toast interaction regressions pass all 30 Linux repetitions under CPU load.
Press-only retention and pointer/focus release also have deliberate DOM-handler mutation checks.
The recording regression now drives each take to its own encoder-start count with the paused clock.
Toasts and modals share one layer order (`docs/design-review/2026-10-25-toast-layering.md`): page
notifications step back under any modal, and a dialog's own feedback renders in that dialog.

Lane C stopped on both browser candidates because their CI traces show a product race. Keep the
assertions in `routing.spec.ts` and `record.spec.ts`; do not hide the race with forced clicks,
dispatchEvent, retries, longer timeouts or a guessed settling delay.

- Routing, run [40213655214, attempt 1](https://github.com/latchkostov/diagrams/actions/runs/40213655214/attempts/1),
  `routing.spec.ts`: rule deletion Undo. The trace's `wzmo@23725` action checks a stable button,
  then targets `(511, 697)`. Between snapshots at trace times 568520.205 and 568558.551, the toast's
  bottom changes from 82px to 132px. The action reports a completed click, but the toast remains
  and the persisted rule list stays `[search]` throughout the restoration assertion.
- Recording, run [40216841095, attempt 1](https://github.com/latchkostov/diagrams/actions/runs/40216841095/attempts/1),
  `record.spec.ts`: successive discards. Action `sdxr@8919` targets `(777.5, 863)`, measured from
  the button at y=850 with height 26. Its input snapshot at trace time 233585.953 already shows
  the toast's bottom at 78px instead of its initial 24px. Undo does not reopen the clip; advancing
  the clock subsequently revokes both URLs. The failure is not evidence of a URL ownership bug.

`Toaster.tsx` samples avoided bars in a layout effect and on a 250ms interval, while its bottom
offset transitions in CSS. In recording, the live bar returns when review closes. A toast can
pass Playwright's two-frame stability check before a later placement update moves it under the
pointer. Routing also has bottom-band bars, including the hint and minimap. Product work should
make the toast's final placement ready before its action becomes interactive, and cover changing
bar geometry while preserving normal pointer coverage. The exact implementation remains open.

The same Linux load sweep also exposes recording countdown/encoder-start timeouts: the fixture's
`started` flag persists between takes, and a single running-clock advance crosses several React
effects. Address deterministic clock sequencing when revisiting the test, without using it to mask
the missed-click product defect. No browser fix or browser mutation result is claimed in this lane.
