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

## Tutorials quarantine - PR #331

The Payments design study (`study-payments`) is quarantined after both fix rounds were used. Cards,
search, next-lesson suggestions and deep links exclude it; saved progress remains on the device.
Its retained completion-sweep and browser cases skip automatically with this fragment as their reason.
Dispatch remains published. Checkout is also quarantined as recorded below. The runner is unchanged.

Restoring Payments requires regression coverage for both Live-inspector edits and Skip with saved-run
caller overrides in R-2a2fc9e8be, followed by the restored completion sweep and browser cases passing.
The payment retry-safety coverage below remains a follow-up.

## [P1/high] R-2a2fc9e8be: Honor saved-run caller overrides in brownout completion

`src/tutorials/catalog/studyPayments.ts`, `survive-psp-brownout` · lenses: correctness

Start PSP brownout before configuring its Request, then set Timeout to 250 ms and enable the breaker
through the Live inspector. CallWaitFields uses effectiveCallerPolicy, which writes these changes
into the saved simulation's setup.edges overrides. Completion reads only the base edge, so the
milestone stays active even when the breaker opens. Skip also patches only the base edge: a saved
breaker:null override continues to disable it, preventing Skip from completing.

**Suggested fix:** Make completion and the reference demo account for effective saved-run caller
settings. Add regressions using the Live inspector's effectiveCallerPolicy write path, including
an explicitly disabled breaker. This quarantine does not attempt that fix.

## [P2/high] R-9298f6e8c5: Require processed traffic before accepting the partition fix

`src/tutorials/catalog/studyDispatch.ts`, `fix-partition-ceiling` · lenses: architecture

After completing Dinner rush, remove Courier pings → Location topic, set replicas and partitions to
four, and run More partitions. The topic backlog stays zero, so its saved expectation passes at four
seconds even though Dispatcher processes nothing.

**Suggested fix:** Require a Dispatcher processed-count threshold in the final milestone while
retaining the partitions comparison and saved expectation. Cover a disconnected input path.

**Resolved in this quarantine round:** The milestone now requires at least ten processed messages,
matching Dinner rush. A regression runs both connected and disconnected inputs: both pass the saved
backlog expectation, but only actual processing can complete the milestone. Dispatch stays published.

## [P2/high] R-1ca28a02d7: Test that an outbox alone cannot complete Never double-charge

`src/tutorials/studies.test.ts`, `never-double-charge` · lenses: tests

The unfinished-diagram assertion runs before the outbox exists, while completion paths also enable
idempotency. Removing the milestone's retry.idempotent requirement therefore escapes these tests
and would allow completion with unsafe PSP retries.

**Suggested fix:** Add “never-double-charge requires idempotent PSP retries”: create both required
outbox Message connections, leave retry.idempotent false, and assert the milestone remains incomplete;
then set it true and assert completion.

## Checkout study quarantine - PR #331 round cap

The Checkout design study (`study-checkout`) is quarantined after reaching the review round cap.
Cards, search, next-lesson suggestions and deep links exclude it; saved progress remains on the
device. Its retained completion-sweep and browser cases skip automatically with this fragment as
their reason. The milestone format and Dispatch study stay published. The runner is unchanged.

Restoring Checkout requires the saved-run caller override regression in R-74a53e25ad, the quota
rejection coverage in R-e09014d38c, and the restored completion sweep and browser cases passing.
The Payments idempotency coverage in R-d88a4b1e01 remains a restoration follow-up. This quarantine
does not attempt any of these fixes.

## [P1/high] R-74a53e25ad: Apply the quota reference to saved-run caller overrides

`src/tutorials/catalog/studyCheckout.ts:184` · lenses: accessibility, architecture, correctness, types

At the final milestone, start Partner quota, set Connection pool to 10 through the Live inspector,
then press Skip. `CallWaitFields` uses `effectiveCallerPolicy`, saving the value under the simulation's
`setup.edges` override. The demo patches only the base edge to 1. Restarting Partner quota retains
the overriding value of 10, so partner rejections continue exceeding the milestone's limit and Skip
never completes. This blocks recovery from an ordinary learner edit.

**Suggested fix:** Replace or clear the saved simulation's `poolConnections` override as well as
updating the base edge. Add a regression that edits through `effectiveCallerPolicy` during Partner
quota before pressing Skip.

## [P2/high] R-e09014d38c: Test that excessive partner rejections prevent completion

`src/tutorials/studies.test.ts:45` · lenses: tests

Checkout's dedicated simulation test covers only the successful tenfold run. Completion-sweep paths
configure the reference connection pool before checking the quota milestone. Removing its rejected
≤ 1 guard would leave these tests green while allowing an over-quota design to complete.

**Suggested fix:** Add “partner quota rejects unpaced calls”: run `partner-quota` with sufficient
Checkout capacity and an unrestricted pool, assert rejected > 1 and incomplete throughout the
eligible interval, then verify `poolConnections: 1` completes with sufficient processed traffic.

## [P2/high] R-d88a4b1e01: Isolate idempotency in the payment safety check

`src/tutorials/studies.test.ts:97` · lenses: tests

The unfinished-diagram assertion runs before either outbox connection exists. Successful demo paths
create those connections and enable idempotency together. Removing the `retry.idempotent` requirement
would escape coverage and let an outbox alone satisfy Never double-charge. Payments is quarantined,
so this is a restoration coverage gap, also tracked by R-1ca28a02d7 above.

**Suggested fix:** Add “never-double-charge requires idempotent PSP retries”: create both required
Message connections, leave `retry.idempotent` false and assert incomplete; set it true and assert complete.
