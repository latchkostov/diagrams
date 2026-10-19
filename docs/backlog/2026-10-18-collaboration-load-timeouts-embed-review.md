## Collaboration timeouts under parallel browser load

Confluence embed review verification ran the full Linux gate at 12 workers and 12 CPUs on
`58163ca4c6851bbc14b1d807951696f4c2d5dff4`. All static checks, unit coverage, builds, entry size and
2,525 parity goldens passed. Browser results were 1,717 passed and two whole-test 30-second timeouts:

- `tests/e2e/collab-c1a.spec.ts`: pasting Private content stops sharing before the paste reaches peers or room recovery.
- `tests/e2e/collab-room.spec.ts`: a copy that can't be saved holds the room's canvas behind a dialog: file copy, Try again.

```text
SUMMARY: 58163ca4c6851bbc14b1d807951696f4c2d5dff4 | unit={"passed":11344,"failed":0,"skipped":4} parity={"goldens":2525,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1717,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

The single clean-master comparison checked out `origin/master` at
`d1b2627fffddff4b579155fc724362ed2a6317db` in the same worktree, with no changes, and ran only those
two spec files twice with the same Linux worker/CPU settings:

```sh
pnpm gate quick tests/e2e/collab-c1a.spec.ts tests/e2e/collab-room.spec.ts --linux --repeat 2 --workers 12 --cpus 12 --only e2e --max-wait 1
```

Repeat one passed all 44 tests. Repeat two passed 42 and timed out two **different**
`collab-room.spec.ts` cases: “Leave keeps your copy in Your diagrams, and Don't join leaves nothing
behind” and “a peer deleting the right-clicked node closes the menu (remote), the canvas takes the
keyboard, the view stays”. Both original failing cases passed both clean-master repetitions;
identical reproduction of those original failures is therefore **not established**.

```text
SUMMARY: d1b2627fffddff4b579155fc724362ed2a6317db | unit="not run" parity="not run" e2e={"passed":86,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

Follow up on collaboration timing under parallel load, including copy/download completion and
test teardown. Preserve assertions and establish the cause before changing any backstop. No
collaboration code, assertions or timeouts were changed for the embed fixes. The embed and UI
neighbour load gate passed all 540 tests across five Linux repetitions, and every output golden
remained unchanged. Further full-suite or clean-master runs were deferred to CI under the
verification budget.
