## Following camera timeouts under Linux load

The camera invariant fix ran the requested eleven camera specs twice in Linux with
eight workers, four CPUs and ports 6720–6724. It recorded 297 passes and nine timeouts.
Only the following identities failed:

| Spec / test                                                                                   | Fix branch failures / repeats | Clean master failures / repeats |
| --------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------- |
| keep-camera: Following an off-screen narration subject pans at the current zoom               | 2 / 2                         | 2 / 2                           |
| keep-camera: Following preserves a visible narrated subject (0px from the frame edge)         | 2 / 2                         | 2 / 2                           |
| keep-camera: Following preserves a visible narrated subject (10px from the frame edge)        | 2 / 2                         | 2 / 2                           |
| keep-camera: Following preserves a visible narrated subject (100px from the frame edge)       | 2 / 2                         | 0 / 2                           |
| workbench-followups (light): Follow retains bottom neighbour pins without trunk intersections | 1 / 2                         | 0 / 2                           |

The clean-master comparison used this same worktree, detached at
`f4baa5ecd2af003ef41417c4f6b214ff2e6dadb2`, with an empty `git status`. Only
`keep-camera.spec.ts` and `workbench-followups.spec.ts` ran, twice, with the same
Linux worker/CPU/port settings. The first three identities reproduced their timeout
failures; the off-screen case still reported `animating` when expecting `idle`.
The last two identities did **not** reproduce and are not established as pre-existing.
Investigate those under broader browser load and inspect PR CI. Do not loosen camera
assertions or change the controller property to accommodate these failures.

Fix-branch report: `tests/.output/g/raa8825`. Clean-master report:
`tests/.output/g/reIAuw2`. These local reports retain errors, screenshots and traces.
The scoped comparison follows the verification budget; no full suite was rerun on master.

Fix-branch targeted gate (started from the base SHA with the working fix):

```text
SUMMARY: f4baa5ecd2af003ef41417c4f6b214ff2e6dadb2 | unit="not run" parity="not run" e2e={"passed":297,"failed":9,"flaky":0,"skipped":0} gate_failures=2
```

Clean-master scoped comparison:

```text
SUMMARY: f4baa5ecd2af003ef41417c4f6b214ff2e6dadb2 | unit="not run" parity="not run" e2e={"passed":46,"failed":6,"flaky":0,"skipped":0} gate_failures=2
```
