## Tutorials quarantine - PR #299

Arrange and Insert on an edge are quarantined after both fix rounds were used. They are unavailable through cards,
search, next-lesson suggestions and deep links. Saved progress stays on the device and is ignored while quarantined.
The retained completion-sweep and browser cases are skipped with this fragment as their reason.

Un-quarantining requires regression tests for **both P1s below** and the completion sweep passing, including the
restored cases. The P2s remain follow-ups; this quarantine does not attempt any of these fixes.

## [P1/high] R-3665ee21fd: Ignore selected edges when checking node alignment

`src/tutorials/checks.ts:145` · lenses: accessibility

In Arrange, connect two seed services before drawing the instructed selection box. The box automatically selects edges between selected nodes. Align middles correctly aligns the services, but this check maps the selected edge ID to undefined and therefore never passes. The learner remains on Align despite performing the requested action.

**Fix:** Filter the committed selection to diagram nodes before applying the minimum count and coordinate comparison. Cover a selection containing four or more services and an edge.

## [P1/high] R-dc523babb0: Avoid duplicating an existing gateway connection on Skip

`src/tutorials/runner.ts:283` · lenses: correctness

In insert-on-edge, select the app, add an API Gateway through Ctrl+K, then click Skip. Adding after the selected app creates app→gateway while retaining app→API. This branch splits app→API through the existing gateway; splitFlowEdge preserves every other edge, producing two app→gateway connections plus gateway→API. The tutorial advances with an incorrect diagram that can also be saved or simulated.

**Fix:** Handle partially connected gateways explicitly: preserve or consolidate the existing half when replacing the original edge, producing exactly app→gateway→API. Add a regression covering a gateway added after a selected app.

## [P2/high] R-cf6cdf20ea: Normalize boundary subjects before comparing selections

`src/tutorials/checks.ts:139` · lenses: architecture

Subjects resolve boundaries to saved group IDs, while mode.selection contains React Flow IDs prefixed with GROUP_PREFIX. Consequently, a selection check naming a boundary always fails even after the select demo selects it correctly. A selection settlement naming that boundary would also wait forever. namingNow() already performs this conversion separately, exposing inconsistent ID handling across the declarative API.

**Fix:** Introduce a shared subject-to-flow-ID adapter and use it for selection checks, naming checks and selection settlements. Cover a boundary subject selected as group:<id>.

## [P2/high] R-8f80384677: Exercise delayed boundary naming during Continue

`src/tutorials/completionSweep.test.ts:214` · lenses: tests

The fake groupNodes publishes naming synchronously, while production requests the lazy Inspector and enters naming when Label receives focus. The Continue sweep therefore cannot detect premature settlement followed by a delayed Label stealing focus after reconstruction.

**Fix:** Add “boundaries: Continue settles a delayed Label”: save progress at drag-in, reload with the Inspector chunk held, Continue, then release it. Assert reconstruction finishes without further input, remains on drag-in, and leaves the boundary name settled.

## [P2/high] R-4292fd18ff: Handle failed async boundary demos explicitly

`src/tutorials/runner.ts:234` · lenses: architecture

moveIntoBoundary returns Promise<boolean>, but this branch discards it, and demos() ignores the promise returned by the group-repair branch too. When placement returns false because collision rules prevent a move, Skip waits indefinitely for state.observed[i], with no failure feedback. A failed boundaryPlacement chunk download also produces an unhandled rejection.

**Fix:** Give perform() a consistent async result contract, await it in demos(), and handle unsuccessful or rejected operations with recoverable feedback before waiting for observation. Add focused false-result and rejection tests.

## [P2/high] R-352145058d: Show annotation-specific completion keys

`src/tutorials/TutorialApp.tsx:460` · lenses: accessibility

The new annotation settlement falls through to tutorials.finishUp, which says to press Enter to finish. Text and Note enter this completing state immediately, but their editor treats Enter as a newline. Following the completion hint changes the annotation and leaves the step open, contradicting the goal's Escape instruction.

**Fix:** Use a translated annotation completion hint naming Escape or Ctrl/Cmd+Enter; retain the existing hint for naming settlement.

## [P2/high] R-26013c9d03: Assert that Skip preserves the annotation draft

`tests/e2e/tutorials.spec.ts:222` · lenses: tests

This regression claims Skip commits the note, but leaves its editor untouched and checks only advancement, editor closure and annotation count. Because the tutorial check also counts annotations, discarding a typed draft could pass both this test and generated solution playback.

**Fix:** Add “annotate: Skip commits typed note text”: fill a distinctive draft before Skip, then assert the rendered note retains that text, exactly one note exists, and the tutorial advances to zone.

## Tutorials quarantine - PR #303

Dependencies, part 2 (`dependencies-2`) is quarantined after both build-05 fix rounds were used. Cards, search,
next-lesson suggestions and deep links exclude it; saved progress remains on the device. Its retained completion-sweep
and browser cases skip automatically through the quarantine flag with this fragment as their reason. Webhooks,
Fan-out, Partitions and Outbox remain available.

Restoring this lesson requires regressions for both Skip and resume reconstruction in R-720a9a5048 and the restored
completion-sweep and browser cases passing. R-7afb59dfff remains a separate Outbox follow-up.

## [P1/high] R-720a9a5048: Show Dependencies when skipping or reconstructing this prerequisite

`src/tutorials/catalog/dependencies2.ts:24` · lenses: correctness

With Dependencies hidden, start `dependencies-2` and press Skip on show-dependencies. The lesson advances to
add-setting without revealing the Config connection: the empty demo latches completion, but the connection remains
hidden and unselectable. Resuming saved progress past that prerequisite also leaves the connection hidden if the
app-wide Dependencies preference was subsequently turned off, so the next instruction cannot be followed.

**Fix:** Provide an idempotent visibility demo that sets Dependencies on during Skip and resume reconstruction.
Cover both paths with the visibility preference initially off.

## [P2/high] R-7afb59dfff: Keep the compensation reading step active until acknowledged

`src/tutorials/catalog/outbox.ts:62` · lenses: accessibility

In Outbox, select “Declines and flaky payments”. At simulation time 2500 ms the compensation narration pauses
playback, but the tutorial finishes at the same point. Finished and Next immediately replace the instruction to read
the note, and screen readers receive completion before the learner can read or continue it. Compensation has not
yet played.

**Fix:** Retain a reading step with Continue and an explicit Done acknowledgment, following read-happy-path.
Verify that reaching the paused compensation note alone does not finish the tutorial.
