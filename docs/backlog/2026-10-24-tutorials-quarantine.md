## Tutorials quarantine - PR #299

Arrange and Insert on an edge were restored on 2026-10-25 after fixing R-3665ee21fd and
R-dc523babb0. Regressions cover mixed node/edge alignment and Skip with either gateway connection half
already present, including a gateway added after the selected app. The P2 follow-ups below remain separate.

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

Dependencies, part 2 (`dependencies-2`) was restored on 2026-10-25. R-720a9a5048 is resolved:
Skip and Continue set Dependencies visible before the setting step, with regressions starting from the
hidden preference. Its setting-lock regression remains enabled. The Outbox follow-up below was already
resolved by its acknowledgment step and is covered by retained completion-sweep and browser cases.

## [P2/high] R-7afb59dfff: Keep the compensation reading step active until acknowledged

`src/tutorials/catalog/outbox.ts:62` · lenses: accessibility

In Outbox, select “Declines and flaky payments”. At simulation time 2500 ms the compensation narration pauses
playback, but the tutorial finishes at the same point. Finished and Next immediately replace the instruction to read
the note, and screen readers receive completion before the learner can read or continue it. Compensation has not
yet played.

**Fix:** Retain a reading step with Continue and an explicit Done acknowledgment, following read-happy-path.
Verify that reaching the paused compensation note alone does not finish the tutorial.

## Checkout study quarantine - PR #346

Checkout (`study-checkout`) is quarantined after the review round cap. Payments, dispatch, fan-out,
RAG and cells remain published. A sweep of `traffic:` and `capacity:` in every study catalog found
only Checkout's two saved simulations author non-1 multipliers: both use traffic ×10. The other
published studies omit multipliers and therefore use traffic ×1 and capacity ×1.

## [P1/high] R-bf8c4f3d0d: Preserve authored traffic multipliers during reference replay

`src/tutorials/repair.ts:53` · lenses: correctness, tests, types

`reference()` resets both multipliers to ×1. Checkout's `tenfold` and `partner-quota` runs are authored
with traffic ×10, so Skip and Continue persist a reduction from 40 to 4 messages/s and demonstrate the
solution at a tenth of the intended load. Subsequent replays retain the weakened workload.

**Fix:** Restore each run's authored multipliers from the lesson's own saved-simulation definition,
using ×1 only for omitted multipliers. Add a completion-sweep case asserting authored non-1 traffic
and capacity multipliers survive reference replay, including Checkout's Skip and Continue at traffic
×10 while repairing learner changes. Keep Checkout quarantined until that behavior is verified.

## [P2/high] R-a6bca6f442: Share the session commands exercised by repair regressions

`src/tutorials/completionSweep.test.ts:213` · lenses: architecture

The sandbox independently implements selection, Run and Save from `src/live/session/useLiveCommands.ts`.
Sandbox Run reads `diagram.simulations` immediately, while production reads the last published
`simsRef.current`. Production draft ownership and persistence can change while the sweep stays green.

**Fix:** Extract session operations into `src/live/session/simulationCommands.ts` with explicit document,
draft and controller ports. Use them from both `useLiveCommands` and the sandbox, leaving simulated
publication scheduling in the test adapter.

## [P2/high] R-f8727feff3: Cover repairs to the suspended Simulations working copy

`tests/e2e/tutorials.spec.ts:728` · lenses: tests

Browser regressions repair with the Simulations panel open, and the sweep models only one `panelCopy`.
Neither exercises LiveSession's separate `suspendedPanelRef` update. Reopening the panel and pressing
Run or Save could restore settings from before the repair without those tests failing.

**Fix:** Add “brownout Skip repairs a suspended panel copy”: edit and run a draft, retain another pending
edit, close the panel, press Skip, then reopen it. Assert pending edits survive and Run and Save retain
the repaired deadline and breaker.
