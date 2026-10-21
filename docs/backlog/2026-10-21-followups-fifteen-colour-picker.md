## Investigate the background colour picker under full browser load

The one Follow-ups 15 full Linux gate on implementation commit
`c60196b822e6dc564946c86653b7ed4623a5379a` failed the untouched
`tests/e2e/colour-picker.spec.ts:130` case, **background tint is undoable and survives presentation in light**.
At line 137, `color-picker-hex-input` did not appear after clicking the inspector's custom colour
button. All other 1,966 browser cases passed. Unit coverage, Docker, build, size and parity passed.

Full-gate summary:

```text
SUMMARY: c60196b822e6dc564946c86653b7ed4623a5379a | unit={"passed":13448,"failed":0,"skipped":4} parity={"goldens":2897,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1966,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Following the verification-budget rule, only the failing spec was run on a clean, detached
`origin/master` snapshot at `a243a07342537b7a85d714a216406e444101c4d1`, inside an ignored scratch
checkout in this worktree. Its dependency install matched the frozen lockfile. Both Linux repetitions
passed at the same declared 12 workers / 12 CPUs; **the full-load failure did not reproduce in isolation**.
This is not proof that the failure predates the branch. Neither the colour-picker spec nor its
inspector/camera implementation changed in Follow-ups 15.

Clean-master targeted summary:

```text
SUMMARY: a243a07342537b7a85d714a216406e444101c4d1 | unit="not run" parity="not run" e2e={"passed":28,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Commands: `pnpm gate full --linux --workers 12 --cpus 12 --max-wait 1`; comparison:
`pnpm gate quick tests/e2e/colour-picker.spec.ts --linux --only e2e --repeat 2 --workers 12 --cpus 12 --max-wait 1`.
Local reports remain in `tests/.output/g/rkg57qv/` and the scratch checkout's
`tests/.output/g/rbCiphv/`. No full suite was rerun on master, and no assertion or timeout was relaxed.

Investigate this under mixed browser load. Capture the pane/camera/interaction state around opening
the inspector and picker; the test currently opens the picker immediately after toggling the inspector.
That missing preparation is a candidate cause, not a confirmed diagnosis. Preserve the colour, Undo,
Redo and presentation assertions. The PR must disclose the unresolved full-gate failure and let CI
run the complete gate, as directed by the verification-budget instructions.
