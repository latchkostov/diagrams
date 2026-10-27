## Toast interaction and UX review

The existing Toaster now holds its current notification and placement while any pointer,
focus or press contact remains. Independent contacts use a small state machine: leaving with
a press held or keyboard focus inside does not release it. New arrivals wait, retaining the
existing latest-wins notification policy. Explicit dismissal and history invalidation still
remove obsolete Undo actions immediately; blocking tasks retain progress and Cancel ownership.

Placement updates resume after engagement ends. Positional transitions and the entrance slide
are removed so an in-flight animation cannot move the action after the pointer reaches it.
The entrance fade respects reduced motion. Existing status/alert roles, live regions and native
action buttons remain. No new editor controls or settings are added.

Forced clicks, sleeps, retries and hover-driven polling timers were rejected: the target itself
must remain stable. The Lab regression delivers another notification and moves an avoided bar
while Undo is hovered, focused or pressed, advances a fake clock past expiry, checks the exact
button box, then activates Undo through the pointer or keyboard. Both motion preferences run.

The named routing case waits for the existing Inspector/selection boundary before opening its
first rule. The named recording case drives its paused clock until each take's encoder reports
started, rather than assuming one large advance or a visible count means the next passive-effect
timer is installed. It skips intermediate frames because this case tests clip ownership, not
elapsed duration. Their Undo assertions and ordinary clicks remain intact.
It also holds Undo past its former expiry: discarded clip URLs now follow toast dismissal,
instead of a fixed cleanup timer that could invalidate the still-available Undo action.

## Validation

- Targeted unit files: 16 passed after restoration, including independent contacts, stale Undo,
  dismissal cleanup, blocking/nonblocking progress and representative machine paths.
- Native production browser run: 8 passed, 0 failed, 0 flaky. An earlier run, before recording
  cleanup followed dismissal, passed 7 and failed the new long-hover URL assertion once.
- Placement mutation: temporarily removing `toast.engaged` from the placement guard failed all
  6 Lab cases. Focus/press boxes moved 100 px; hovered actions could disappear after moving away
  from the pointer. The guard was restored byte for byte.
- Notification-retention mutation: ignoring the held toast failed 4 store tests (7 passed in that
  run). The held selection was restored; the final targeted unit run passed all 16 tests.

The first Linux 30-repeat, 6-worker, 2-CPU run was stopped after 4 recording setup timeouts:
35 passed, 4 failed, 201 skipped/interrupted. Two failures waited on the countdown/indicator,
and two exhausted the whole-test backstop during Stop/Discard. None reached a missed Undo.
The frame-replaying countdown helper still raced timer installation under this load; the named
case now advances directly to each encoder-start boundary. No timeout was increased.

After that clock change, another 2-CPU run was stopped at 28 passed, 2 failed and 210
skipped/interrupted. The first failed trace completed the Undo and URL assertions, but the whole
two-recording flow exhausted the unchanged 30-second test backstop under six-way CPU contention.

The final load command uses 6 workers on 4 CPUs (still more workers than CPUs), repeats each
of the same 8 production browser cases 30 times, and keeps zero retries and all existing
timeouts/assertions. Final counts and the exact gate summary are reported in the PR and completion
report. Initial admission attempts exited busy (75); no budget locks were altered.

`pnpm gate quick tests/e2e/toast-interaction.spec.ts tests/e2e/routing.spec.ts:121 tests/e2e/record.spec.ts:206 --only e2e --linux --workers 6 --cpus 4 --repeat-each 30 --ports 6840 --max-wait 0.02`

This fix round does not run a full gate, broad suites or output parity; PR CI supplies those
checks. No goldens are re-recorded. The committed skill viewer is regenerated from current sources.
