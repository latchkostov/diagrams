## Collaboration timeouts in the full Linux gate

The requests-wait review fixes at `0e6a62287e7d00277392fc15778c1436d34df1ce` passed all static
checks, unit coverage, builds, entry size and output parity. The one full Linux gate used 12 workers
and 12 CPUs. Five Chromium cases reached the existing 30-second whole-test backstop:

- `collab-c1a.spec.ts:213`: isolated editors preserve a pending inspector edit, scope Undo/Redo, and handle remote deletion.
- `collab-c1a.spec.ts:638`: remote stencil changes restore focus when the focused inspector control disappears.
- `collab-c1a.spec.ts:722`: pasting Private content stops sharing before the paste reaches peers or room recovery.
- `collab-c1a.spec.ts:950`: a peer edit between image export slices aborts with a retry toast and preserves scoped Undo.
- `collab-room.spec.ts:602`: Share's Edit together, after Link with password and never first, starts a room from the open diagram.

```text
SUMMARY: 0e6a62287e7d00277392fc15778c1436d34df1ce | unit={"passed":11915,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1780,"failed":5,"flaky":0,"skipped":0} gate_failures=1
```

## Focused comparison

A clean local clone of `origin/master` at `c3d15a42c3c0f455769ea8817442580b37b3e028`, inside
this checkout's ignored test-output directory, ran only the two affected specs once with two repetitions:

```sh
pnpm gate quick tests/e2e/collab-c1a.spec.ts tests/e2e/collab-room.spec.ts --linux --only e2e --repeat 2 --workers 12 --cpus 12 --max-wait 1
```

Both repetitions passed all 45 cases. The feature branch then ran the identical focused command;
both repetitions passed there too. These quick comparisons use the gate's bind source mode; the
full run uses its archived-HEAD mode. Identical reproduction on clean master is **not established**.

```text
SUMMARY: c3d15a42c3c0f455769ea8817442580b37b3e028 | unit="not run" parity="not run" e2e={"passed":90,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 0e6a62287e7d00277392fc15778c1436d34df1ce | unit="not run" parity="not run" e2e={"passed":90,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Investigate full-suite interference, resource pressure and teardown around these collaboration cases.
Preserve assertions and establish the cause before changing any backstop. No collaboration code,
assertions or timeouts were changed for the waiting fixes. The affected waiting/UI-neighbour sweep
passed all 930 cases across five Linux repetitions, and all six P1 regressions fail against c45bcba9.
Further full-suite or clean-master runs are deferred to PR CI under the verification-budget instruction.

Related earlier evidence: [collaboration load timeouts during embed review](2026-10-18-collaboration-load-timeouts-embed-review.md).
