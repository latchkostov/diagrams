## Verification revision

[Nightly 40828806506](https://github.com/latchkostov/diagrams/actions/runs/40828806506)
runs source/test head `786d00b96b3237698961a2e9d9630c1725e45eea`, synced onto #392.
Final browser matrix: **Dev 6/8 shards pass, 2 fail; Build 11/12 pass, 1 fails**.
All twenty jobs completed.

The pending/failed locale paths, both Greek rail widths, AI context, boundary drag,
inspector edit/undo, tutorial Skip-all, timeline and dev SVG-export cases pass.
All six PR E2E shards and the static/unit/heavy/build/parity checks also pass at
this revision. No goldens changed. This is not a claim that Nightly is green.

## Remaining original single: Checks readiness

[Dev 3, job 123298328408](https://github.com/latchkostov/diagrams/actions/runs/40828806506/job/123298328408)
passes 377 cases, skips 32 existing declarations and fails three executions of
`requests-wait-checks.spec.ts:68` (English, Arabic and pseudo-locale). At line 81,
`check-fix-blocked-threads:caller` is absent throughout the existing assertion
backstop. All three error snapshots show the expected diagram and the Checks dock
still displaying Checking, with no finding controls. This strengthens the original
Arabic-only evidence; a catalog interception change cannot repair it.

The same cases passed both local Dev and Linux Build repetitions, and the first
dispatch. The failure mechanism remains unresolved. Capture the current document's
worker lifecycle and hold/release its result deterministically before changing the
application or test readiness. Preserve the keyboard, primary-fix and option-chip
assertions and the current backstops. Do not claim an isolated passing replay as a fix.

## Newly observed browser failures

- [Dev 2, job 123298328468](https://github.com/latchkostov/diagrams/actions/runs/40828806506/job/123298328468):
  `drawing-precision.spec.ts:143`, Ctrl/Cmd turns snapping off. The horizontal
  position error is 3.305 rather than less than 1.5; 286 cases pass, one existing
  declaration is skipped. The downloaded trace and error snapshot are retained.
  Determine whether the starting camera transform changes during the drag before
  changing any snapping logic. Preserve the position and non-snapping assertions.
- [Build 10, job 123298328377](https://github.com/latchkostov/diagrams/actions/runs/40828806506/job/123298328377):
  `hover-cards.spec.ts:729`, removing a focused edge readout target. Line 740's
  click never finds `edge-detail-call` within the existing action backstop; 758
  cases pass. The downloaded `nightly-output-repeat-10` artifact contains the
  failure trace and snapshot. Establish hover/readout publication and pointer
  placement before changing focus recovery. Preserve the removal/focus assertions.

These are new observations outside the named singles, not proven baseline failures.
No assertion, timeout, tolerance, retry, skip or budget was changed to conceal them.

## Separate randomized unit failure

[Random property job 123297971706](https://github.com/latchkostov/diagrams/actions/runs/40828806506/job/123297971706)
fails the camera-controller interleaving invariant at `controller.test.ts:796`.
Seed `-1137467820`, path `3725:3:5`, shrinks to
`menu.open, narration(true), frame(1000x800), panel, slowmo(true), frame(1000x800)`.
The controller and its property test are unchanged by this branch. Retain the seed
for a focused reproduction; no clean-master reproduction is claimed here.

## Evidence location

Logs were retrieved with `gh api --allow-escape-sequences` and the artifacts with
`gh run download`. Local raw evidence is under `tests/.output/nightly-evidence/`.
The PR links the final Dev and Build job outcomes separately from other Nightly jobs.
